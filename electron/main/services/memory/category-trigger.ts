// 智能分类触发编排：incremental（单会话）+ full-rebuild（工作区全量）
import {
  TaskType, TaskStatus, type AgentTask, type CategorizeSessionPayload,
} from '../../agents/task-types.js';
import { mainLogger } from '../../agents/logger.js';
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';
import type { CategorizeActivity, CategorizeRecentEntry } from '../../types.js';
import { whenMigrationReady } from './migration-gate.js';

type CategorizeJob =
  | { kind: 'incremental'; workspaceId: string; groupId: string; groupDigestPath: string }
  | { kind: 'full-rebuild'; workspaceId: string };

const inFlight = new Set<string>();
const queue: CategorizeJob[] = [];
let pumping = false;

export type CategorizeOutcome = 'match' | 'join' | 'new' | 'skip' | 'error' | 'cancelled';

const RECENT_MAX = 15;
let current: CategorizeActivity['current'] = null;
let currentTaskId: string | null = null;
const recent: CategorizeRecentEntry[] = [];
let lastScan: CategorizeActivity['lastScan'] = null;

/**
 * 由 worker result + error 判定结果类别（纯函数，可单测）
 * - cancelled / error 直接判
 * - 否则按 decisions 计数里非零键的优先级判定：match > join > new > skip > error
 *   incremental 模式下 decisions 通常只有 1 个非零键（单条决策）
 *   full-rebuild 多条聚合，主要看里面是不是有 error；优先级仍按上面排
 */
export function classifyCategorizeOutcome(
  result: any,
  error?: string,
  status?: TaskStatus,
): CategorizeOutcome {
  if (status === TaskStatus.CANCELLED || result?.cancelled) return 'cancelled';
  if (error || result?.error) return 'error';
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
  return job.kind === 'incremental'
    ? `c:${job.workspaceId}:${job.groupId}`
    : `r:${job.workspaceId}`;
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

  // 拿 workspacePath
  const { getById: getWorkspaceById } = await import('../workspace-json-service.js');
  const ws = await getWorkspaceById(job.workspaceId);
  if (!ws) {
    pushRecent('error', { error: `工作区未找到: ${job.workspaceId}` });
    return;
  }

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

  const task: AgentTask = {
    id: `categorize-${jobKey(job)}-${Date.now()}`,
    type: TaskType.CATEGORIZE_SESSION,
    status: TaskStatus.PENDING,
    payload,
    createdAt: Date.now(),
  };

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
        const outcome = classifyCategorizeOutcome(result, error, status);
        pushRecent(outcome, {
          decisions: result?.decisions,
          tier: result?.tier,
          profileName: result?.profileName,
          error: error ?? result?.error ?? (status === TaskStatus.CANCELLED ? '已取消' : undefined),
        });
        // 索引真的改了才广播（match/join/new），skip/error/cancelled 不广播
        if (outcome === 'match' || outcome === 'join' || outcome === 'new') {
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

/** 手动触发：清空 + 全量重做（设置页"立即重跑全部分类"按钮用） */
export async function triggerFullRebuild(workspaceId: string): Promise<void> {
  await whenMigrationReady();
  enqueue({ kind: 'full-rebuild', workspaceId });
}

/** 取消当前正在跑的任务（如有）。返回是否真的取消了 */
export async function cancelCurrent(): Promise<boolean> {
  if (!currentTaskId) return false;
  const { getAgentManager } = await import('../../agents/agent-manager.js');
  getAgentManager().cancelTask(currentTaskId);
  return true;
}
