// 组级摘要卡提炼触发编排（Phase 3 Step 2）：替代旧 digest-trigger
// 串行队列并发=1 + in-flight 去重（按 ${workspaceId}:${groupId}）
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  TaskType, TaskStatus, type AgentTask, type GroupDigestSessionPayload,
} from '../../agents/task-types.js';
import {
  scanAllWorkspaces, findDirtyGroup, type DirtyGroup,
} from './group-digest-scanner.js';
import { readGroupDigest, getGroupDigestPath } from './group-digest-store.js';
import { mainLogger } from '../../agents/logger.js';
import { getConfigDir } from '../settings-service.js';
import { whenMigrationReady } from './migration-gate.js';

export type GroupDigestOutcome = 'saved' | 'no-card' | 'error';

export interface GroupDigestRecentEntry {
  workspaceId: string;
  groupId: string;
  finishedAt: number;
  outcome: GroupDigestOutcome;
  tier?: string;
  profileName?: string;
  error?: string;
  durationMs: number;
}

export interface GroupDigestActivity {
  current: { workspaceId: string; groupId: string; startedAt: number; taskId: string } | null;
  queueDepth: number;
  recent: GroupDigestRecentEntry[];
  lastScan: { at: number; dirtyCount: number } | null;
}

// ─── 队列状态 ───

interface QueueEntry {
  workspaceId: string;
  workspacePath: string;
  groupId: string;
}

const inFlight = new Set<string>();
const queue: QueueEntry[] = [];
let pumping = false;
const idleWaiters: Array<() => void> = [];

const RECENT_MAX = 15;
let current: GroupDigestActivity['current'] = null;
const recent: GroupDigestRecentEntry[] = [];
let lastScan: GroupDigestActivity['lastScan'] = null;

// ─── 活动状态持久化 ───
// recent / lastScan 落 <configDir>/digest-activity.json，避免重启后设置面板看不到历史

interface DigestActivityDoc {
  version: 1;
  recent: GroupDigestRecentEntry[];
  lastScan: GroupDigestActivity['lastScan'];
  updatedAt: number;
}

function getActivityPath(): string {
  return path.join(getConfigDir(), 'digest-activity.json');
}

let writeTimer: NodeJS.Timeout | null = null;

function schedulePersist(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void persistActivity();
  }, 500);
}

async function persistActivity(): Promise<void> {
  try {
    const doc: DigestActivityDoc = {
      version: 1,
      recent: recent.slice(0, RECENT_MAX),
      lastScan,
      updatedAt: Date.now(),
    };
    await fs.writeFile(getActivityPath(), JSON.stringify(doc, null, 2), 'utf-8');
  } catch (err) {
    mainLogger.warn('[group-digest] 持久化 activity 失败:', err);
  }
}

// 模块加载时同步加载磁盘状态（文件小，同步读无性能问题；让前端首次拉 activity 即拿到历史）
try {
  const raw = fsSync.readFileSync(getActivityPath(), 'utf-8');
  const doc = JSON.parse(raw) as DigestActivityDoc;
  if (doc && doc.version === 1) {
    if (Array.isArray(doc.recent)) recent.push(...doc.recent.slice(0, RECENT_MAX));
    if (doc.lastScan) lastScan = doc.lastScan;
  }
} catch {
  // 文件不存在或损坏：用默认空状态
}

function entryKey(e: QueueEntry): string {
  return `${e.workspaceId}:${e.groupId}`;
}

export function whenGroupDigestIdle(): Promise<void> {
  if (!pumping && queue.length === 0 && inFlight.size === 0) return Promise.resolve();
  return new Promise<void>((resolve) => idleWaiters.push(resolve));
}

/** 由 worker result + error 判定结果类别 */
export function classifyGroupDigestOutcome(result: any, error?: string): GroupDigestOutcome {
  if (error || result?.error) return 'error';
  return result?.saved ? 'saved' : 'no-card';
}

export function getGroupDigestActivity(): GroupDigestActivity {
  return {
    current,
    queueDepth: queue.length + inFlight.size,
    recent: recent.slice(),
    lastScan,
  };
}

function enqueue(e: QueueEntry): void {
  const k = entryKey(e);
  if (inFlight.has(k)) return;
  inFlight.add(k);
  queue.push(e);
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const e = queue.shift()!;
      try {
        await runOne(e);
      } catch (err) {
        mainLogger.warn('[group-digest] 任务异常:', entryKey(e), err);
      } finally {
        inFlight.delete(entryKey(e));
      }
    }
  } finally {
    pumping = false;
    if (queue.length === 0 && inFlight.size === 0) {
      const waiters = idleWaiters.splice(0);
      for (const w of waiters) w();
    }
  }
}

async function runOne(e: QueueEntry): Promise<void> {
  const startedAt = Date.now();
  const { workspaceId, workspacePath, groupId } = e;

  const pushRecent = (outcome: GroupDigestOutcome, extra: Partial<GroupDigestRecentEntry>) => {
    recent.unshift({
      workspaceId,
      groupId,
      finishedAt: Date.now(),
      outcome,
      durationMs: Date.now() - startedAt,
      ...extra,
    });
    if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
    current = null;
    schedulePersist();
  };

  // 脏检查
  const dirtyGroup = await findDirtyGroup(workspaceId, workspacePath, groupId);
  if (!dirtyGroup) {
    // 不脏，跳过（不入 recent）
    return;
  }

  const existingCard = await readGroupDigest(workspaceId, groupId);

  const payload: GroupDigestSessionPayload = {
    workspaceId,
    workspacePath,
    groupId,
    dirtyConversations: dirtyGroup.dirtyConversations,
    hasExistingCard: !!existingCard,
  };

  const task: AgentTask = {
    id: `group-digest-${groupId}-${Date.now()}`,
    type: TaskType.GROUP_DIGEST_SESSION,
    status: TaskStatus.PENDING,
    payload,
    createdAt: Date.now(),
  };

  current = { workspaceId, groupId, startedAt, taskId: task.id };

  const { getAgentManager } = await import('../../agents/agent-manager.js');
  await new Promise<void>((resolve) => {
    getAgentManager().submitTask(task, (_taskId, status, result, error) => {
      if (
        status === TaskStatus.COMPLETED ||
        status === TaskStatus.FAILED ||
        status === TaskStatus.CANCELLED
      ) {
        const outcome = status === TaskStatus.CANCELLED ? 'error' : classifyGroupDigestOutcome(result, error);
        pushRecent(outcome, {
          tier: result?.tier,
          profileName: result?.profileName,
          error: error ?? result?.error ?? (status === TaskStatus.CANCELLED ? '已取消' : undefined),
        });
        if (status === TaskStatus.COMPLETED && outcome === 'saved') {
          const groupDigestPath = getGroupDigestPath(workspaceId, groupId);
          void chainCategorize(workspaceId, groupId, groupDigestPath);
        }
        resolve();
      }
    }).catch((err) => {
      mainLogger.warn('[group-digest] 提交任务失败:', entryKey(e), err);
      pushRecent('error', { error: String(err) });
      resolve();
    });
  });
}

/** 组卡 saved 后异步串联触发分类，不阻塞 digest 队列 */
async function chainCategorize(workspaceId: string, groupId: string, groupDigestPath: string): Promise<void> {
  try {
    const { loadSettings } = await import('../settings-service.js');
    const settings = await loadSettings();
    if (settings.smartCategory?.enabled === false) return;

    const card = await readGroupDigest(workspaceId, groupId);
    if (!card?.tags) return;

    const { triggerCategorize } = await import('./category-trigger.js');
    void triggerCategorize(workspaceId, groupId, groupDigestPath);
  } catch (err) {
    mainLogger.warn('[group-digest→category] 串联触发失败:', workspaceId, groupId, err);
  }
}

/** 触发点①/②：扫所有工作区所有 group → dirty 的提交 */
export async function triggerScanAll(): Promise<void> {
  await whenMigrationReady();
  mainLogger.info('[group-digest] 开始全量扫描');
  const dirtyGroups = await scanAllWorkspaces();
  const dirtyCount = dirtyGroups.length;
  lastScan = { at: Date.now(), dirtyCount };
  schedulePersist();
  mainLogger.info(`[group-digest] 扫描完成，发现 ${dirtyCount} 个 dirty 组`);
  for (const g of dirtyGroups) {
    enqueue({ workspaceId: g.workspaceId, workspacePath: g.workspacePath, groupId: g.groupId });
  }
}

/** 触发点③：关会话后只扫该会话所属工作区/组 */
export async function triggerByConversation(convId: string): Promise<void> {
  await whenMigrationReady();
  try {
    const { getByIdGlobal } = await import('../conversation-service.js');
    const found = await getByIdGlobal(convId);
    if (!found?.conv.groupId) return;

    const { getById: getWorkspaceById } = await import('../workspace-json-service.js');
    const ws = await getWorkspaceById(found.workspaceId);
    if (!ws) return;

    enqueue({ workspaceId: found.workspaceId, workspacePath: ws.path, groupId: found.conv.groupId });
  } catch (err) {
    mainLogger.warn('[group-digest] triggerByConversation 失败:', convId, err);
  }
}

/** 手动入口：指定单个 group */
export async function triggerByGroup(workspaceId: string, workspacePath: string, groupId: string): Promise<void> {
  await whenMigrationReady();
  enqueue({ workspaceId, workspacePath, groupId });
}

/**
 * 一键停止：清空待跑队列 + 取消当前正在跑的任务。
 * 已落盘的组卡不受影响（下次扫描时 isGroupDirty 会跳过）。
 */
export async function cancelAllGroupDigest(): Promise<{ cancelledQueued: number; cancelledCurrent: boolean }> {
  const cancelledQueued = queue.length;
  queue.length = 0;
  inFlight.clear();

  const cancelledCurrent = current !== null;
  if (current) {
    try {
      const { getAgentManager } = await import('../../agents/agent-manager.js');
      getAgentManager().cancelTask(current.taskId);
    } catch (err) {
      mainLogger.warn('[group-digest] cancelTask 失败:', err);
    }
  }

  // pump 当前若在 await runOne，cancelTask 会让回调触发 resolve，pump 自然退出
  // 但若 pump 不在跑（pumping=false），waiters 不会自动被通知
  const waiters = idleWaiters.splice(0);
  for (const w of waiters) w();

  mainLogger.info(`[group-digest] 一键停止: queue=${cancelledQueued}, current=${cancelledCurrent}`);
  return { cancelledQueued, cancelledCurrent };
}
