// 组级摘要卡提炼触发编排（Phase 3 Step 2）：替代旧 digest-trigger
// 串行队列并发=1 + in-flight 去重（按 ${workspaceId}:${groupId}）
import {
  TaskType, TaskStatus, type AgentTask, type GroupDigestSessionPayload,
} from '../../agents/task-types.js';
import {
  scanAllWorkspaces, findDirtyGroup, type DirtyGroup,
} from './group-digest-scanner.js';
import { readGroupDigest, getGroupDigestPath } from './group-digest-store.js';
import { mainLogger } from '../../agents/logger.js';

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
    triggerCategorize(workspaceId, groupId, groupDigestPath);
  } catch (err) {
    mainLogger.warn('[group-digest→category] 串联触发失败:', workspaceId, groupId, err);
  }
}

/** 触发点①/②：扫所有工作区所有 group → dirty 的提交 */
export async function triggerScanAll(): Promise<void> {
  mainLogger.info('[group-digest] 开始全量扫描');
  const dirtyGroups = await scanAllWorkspaces();
  const dirtyCount = dirtyGroups.length;
  lastScan = { at: Date.now(), dirtyCount };
  mainLogger.info(`[group-digest] 扫描完成，发现 ${dirtyCount} 个 dirty 组`);
  for (const g of dirtyGroups) {
    enqueue({ workspaceId: g.workspaceId, workspacePath: g.workspacePath, groupId: g.groupId });
  }
}

/** 触发点③：关会话后只扫该会话所属工作区/组 */
export async function triggerByConversation(convId: string): Promise<void> {
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
  enqueue({ workspaceId, workspacePath, groupId });
}
