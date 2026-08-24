// 智能分类触发编排：incremental（单会话）+ full-rebuild（工作区全量）+ organize（存量整理）
import {
  TaskType, TaskStatus, type AgentTask, type CategorizeSessionPayload, type CategorizeOrganizeSessionPayload,
} from '../../agents/task-types.js';
import { mainLogger } from '../../agents/logger.js';
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';
import type { CategorizeActivity, CategorizeRecentEntry } from '../../types.js';
import { whenMigrationReady } from './migration-gate.js';

type CategorizeJob =
  | { kind: 'incremental'; workspaceId: string; groupId: string; groupDigestPath: string }
  | { kind: 'full-rebuild'; workspaceId: string }
  | { kind: 'organize'; workspaceId: string };

const inFlight = new Set<string>();
const queue: CategorizeJob[] = [];
let pumping = false;

export type CategorizeOutcome = 'match' | 'join' | 'new' | 'skip' | 'error' | 'cancelled' | 'done';

const RECENT_MAX = 15;
let current: CategorizeActivity['current'] = null;
let currentTaskId: string | null = null;
const recent: CategorizeRecentEntry[] = [];
let lastScan: CategorizeActivity['lastScan'] = null;

/**
 * 由 worker result + error 判定结果类别（纯函数，可单测）
 * - cancelled / error 直接判
 * - organize 任务不产出 match/join/new 决策，成功即 'done'
 * - 否则按 decisions 计数里非零键的优先级判定：match > join > new > skip > error
 *   incremental 模式下 decisions 通常只有 1 个非零键（单条决策）
 *   full-rebuild 多条聚合，主要看里面是不是有 error；优先级仍按上面排
 */
export function classifyCategorizeOutcome(
  result: any,
  error?: string,
  status?: TaskStatus,
  isOrganize?: boolean,
): CategorizeOutcome {
  if (status === TaskStatus.CANCELLED || result?.cancelled) return 'cancelled';
  if (error || result?.error) return 'error';
  if (isOrganize) return 'done';
  const d = (result?.decisions ?? {}) as Record<string, number>;
  if ((d.match ?? 0) > 0) return 'match';
  if ((d.join ?? 0) > 0) return 'join';
  if ((d.new ?? 0) > 0) return 'new';
  if ((d.skip ?? 0) > 0) return 'skip';
  if ((d.error ?? 0) > 0) return 'error';
  return 'skip';
}

export function getCategorizeActivity(): CategorizeActivity {
  return {
    current,
    queueDepth: queue.length + inFlight.size,
    recent: recent.slice(),
    lastScan,
  };
}

function jobKey(job: CategorizeJob): string {
  if (job.kind === 'incremental') return `c:${job.workspaceId}:${job.groupId}`;
  if (job.kind === 'organize') return `o:${job.workspaceId}`;
  return `r:${job.workspaceId}`;
}

function enqueue(job: CategorizeJob): void {
  const k = jobKey(job);
  if (inFlight.has(k)) return;
  inFlight.add(k);
  queue.push(job);
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        await runOne(job);
      } catch (err) {
        mainLogger.warn('[smart-category] 任务异常:', jobKey(job), err);
      } finally {
        inFlight.delete(jobKey(job));
      }
    }
  } finally {
    pumping = false;
  }
}

async function runOne(job: CategorizeJob): Promise<void> {
  const startedAt = Date.now();

  const pushRecent = (outcome: CategorizeOutcome, extra: Partial<CategorizeRecentEntry>) => {
    recent.unshift({
      workspaceId: job.workspaceId,
      kind: job.kind,
      groupId: job.kind === 'incremental' ? job.groupId : undefined,
      finishedAt: Date.now(),
      outcome,
      durationMs: Date.now() - startedAt,
      ...extra,
    });
    if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
    current = null;
    currentTaskId = null;
  };

  if (job.kind === 'incremental') {
    const { getGroup } = await import('../group-service.js');
    const group = await getGroup(job.workspaceId, job.groupId);
    if (!group || group.archivedAt !== undefined) {
      pushRecent('skip', { error: '话题已归档或不存在' });
      return;
    }
  }

  // 拿 workspacePath
  const { getById: getWorkspaceById } = await import('../workspace-json-service.js');
  const ws = await getWorkspaceById(job.workspaceId);
  if (!ws) {
    pushRecent('error', { error: `工作区未找到: ${job.workspaceId}` });
    return;
  }

  let task: AgentTask;
  if (job.kind === 'organize') {
    const payload: CategorizeOrganizeSessionPayload = { workspaceId: job.workspaceId };
    task = {
      id: `categorize-${jobKey(job)}-${Date.now()}`,
      type: TaskType.CATEGORIZE_ORGANIZE,
      status: TaskStatus.PENDING,
      payload,
      createdAt: Date.now(),
    };
  } else {
    const payload: CategorizeSessionPayload = job.kind === 'incremental'
      ? {
          workspaceId: job.workspaceId,
          workspacePath: ws.path,
          mode: 'incremental',
          groupId: job.groupId,
          groupDigestPath: job.groupDigestPath,
        }
      : {
          workspaceId: job.workspaceId,
          workspacePath: ws.path,
          mode: 'full-rebuild',
        };
    task = {
      id: `categorize-${jobKey(job)}-${Date.now()}`,
      type: TaskType.CATEGORIZE_SESSION,
      status: TaskStatus.PENDING,
      payload,
      createdAt: Date.now(),
    };
  }

  current = {
    workspaceId: job.workspaceId,
    groupId: job.kind === 'incremental' ? job.groupId : undefined,
    kind: job.kind,
    startedAt,
    taskId: task.id,
  };
  currentTaskId = task.id;

  const { getAgentManager } = await import('../../agents/agent-manager.js');
  await new Promise<void>((resolve) => {
    getAgentManager().submitTask(task, (_taskId, status, result, error) => {
      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED || status === TaskStatus.CANCELLED) {
        const outcome = classifyCategorizeOutcome(result, error, status, job.kind === 'organize');
        pushRecent(outcome, {
          decisions: result?.decisions,
          tier: result?.tier,
          profileName: result?.profileName,
          error: error ?? result?.error ?? (status === TaskStatus.CANCELLED ? '已取消' : undefined),
        });
        // 索引真的改了才广播（match/join/new/done；full-rebuild 全 skip 也替换了索引需广播）
        const indexChanged = outcome === 'match' || outcome === 'join' || outcome === 'new' || outcome === 'done'
          || (job.kind !== 'incremental' && outcome === 'skip');
        if (indexChanged) {
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue;
            try {
              getRendererHandlers<RendererHandlers>(win.webContents)
                .categoriesUpdated.send({ workspaceId: job.workspaceId });
            } catch {
              // ignore destroyed windows
            }
          }
        }
        resolve();
      }
    }).catch((err) => {
      mainLogger.warn('[smart-category] 提交任务失败:', jobKey(job), err);
      pushRecent('error', { error: String(err) });
      resolve();
    });
  });
}

/** 手动触发：单条增量决策（组 digest saved 后串联） */
export async function triggerCategorize(workspaceId: string, groupId: string, groupDigestPath: string): Promise<void> {
  await whenMigrationReady();
  enqueue({ kind: 'incremental', workspaceId, groupId, groupDigestPath });
}

/**
 * 补漏触发：幂等差集扫描（有 tags 的活跃组卡 − 分类挂载并集），逐组入队 incremental。
 * 差集为空即 no-op；无 tags 只计数引导重提炼，不入队。
 */
export async function triggerCategorizeSweep(
  workspaceId: string,
): Promise<{ disabled: boolean; pending: number; noTags: number }> {
  await whenMigrationReady();

  const { loadSettings } = await import('../settings-service.js');
  const settings = await loadSettings();
  if (settings.smartCategory?.enabled === false) return { disabled: true, pending: 0, noTags: 0 };

  const fs = await import('node:fs/promises');
  const { getGroupsRootDir, getGroupDigestPath, parseGroupDigest } = await import('./group-digest-store.js');
  const { getGroup } = await import('../group-service.js');
  const { readIndex } = await import('./smart-category-store.js');
  const { collectSweepTargets } = await import('./smart-category-engine.js');

  const entries: Array<{ groupId: string; hasTags: boolean; archived: boolean; digestPath: string }> = [];
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await fs.readdir(getGroupsRootDir(workspaceId), { withFileTypes: true });
  } catch {
    return { disabled: false, pending: 0, noTags: 0 };
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith('_')) continue;
    const digestPath = getGroupDigestPath(workspaceId, dirent.name);
    let raw: string;
    try {
      raw = await fs.readFile(digestPath, 'utf-8');
    } catch (err) {
      mainLogger.warn('[smart-category] sweep 读组卡失败，跳过:', digestPath, err);
      continue;
    }
    const card = parseGroupDigest(raw);
    if (!card?.groupId) {
      mainLogger.warn('[smart-category] sweep 解析组卡失败，跳过:', digestPath);
      continue;
    }
    const group = await getGroup(workspaceId, card.groupId);
    entries.push({
      groupId: card.groupId,
      hasTags: card.tags !== undefined,
      archived: group?.archivedAt !== undefined,
      digestPath,
    });
  }

  const idx = await readIndex(workspaceId);
  const mountedGroupIds = new Set<string>();
  for (const cat of idx.categories) {
    for (const gid of cat.groupIds) mountedGroupIds.add(gid);
  }

  const { sweep, noTags } = collectSweepTargets(entries, mountedGroupIds);
  for (const g of sweep) {
    void triggerCategorize(workspaceId, g.groupId, g.digestPath);
  }
  return { disabled: false, pending: sweep.length, noTags };
}

/** 手动触发：清空 + 全量重做（设置页"立即重跑全部分类"按钮用） */
export async function triggerFullRebuild(workspaceId: string): Promise<void> {
  await whenMigrationReady();
  enqueue({ kind: 'full-rebuild', workspaceId });
}

/**
 * 手动触发：存量分类整理（设置页"一键整理现有标签"按钮用）
 * 与 incremental/full-rebuild 共享同一串行队列，天然互斥。
 */
export async function triggerCategorizeOrganize(workspaceId: string): Promise<void> {
  await whenMigrationReady();
  enqueue({ kind: 'organize', workspaceId });
}

/** 取消当前正在跑的任务（如有）。返回是否真的取消了 */
export async function cancelCurrent(): Promise<boolean> {
  if (!currentTaskId) return false;
  const { getAgentManager } = await import('../../agents/agent-manager.js');
  getAgentManager().cancelTask(currentTaskId);
  return true;
}

/** 取消当前正在跑的 organize 任务；仅当当前活动确实是 organize 时才生效，避免误取消 per-group 任务 */
export async function cancelCategorizeOrganize(): Promise<boolean> {
  if (current?.kind !== 'organize') return false;
  return cancelCurrent();
}

/** 一键停止：清空共享队列（含 incremental/full-rebuild/organize）+ 取消当前任务 */
export function cancelAllCategorize(): { cancelledQueued: number; cancelledCurrent: boolean } {
  const cancelledQueued = queue.length;
  queue.length = 0;
  inFlight.clear();
  const cancelledCurrent = currentTaskId !== null;
  if (cancelledCurrent) {
    void cancelCurrent().catch((err) => mainLogger.warn('[smart-category] cancelTask 失败:', err));
  }
  mainLogger.info(`[smart-category] 一键停止: queue=${cancelledQueued}, current=${cancelledCurrent}`);
  return { cancelledQueued, cancelledCurrent };
}
