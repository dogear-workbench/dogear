// 复盘触发编排：把过时工作区转成 REVIEW_SESSION 任务，串行提交（并发=1）
import {
  TaskType, TaskStatus, type AgentTask, type ReviewSessionPayload,
} from '../../agents/task-types.js';
import type { StaleWorkspace } from './review-scanner.js';
import { mainLogger } from '../../agents/logger.js';
import { readReport, saveReport } from './review-store.js';
import { whenMigrationReady } from './migration-gate.js';

/**
 * agent 决定不写报告时，touch dashboard.md 的 updatedAt。
 * 保留原 markdown（无则写空串），只把 updatedAt 刷成"现在"——
 * 避免 isReportStale 一直判脏、导致每次启动都白跑一次 review agent。
 */
async function touchReportUpdatedAt(workspaceId: string): Promise<void> {
  const existing = await readReport(workspaceId);
  await saveReport(workspaceId, existing?.markdown ?? '');
}

const inFlight = new Set<string>();
const queue: StaleWorkspace[] = [];
let pumping = false;

export type ReviewOutcome = 'saved' | 'no-card' | 'error';

export interface ReviewRecentEntry {
  workspaceId: string;
  finishedAt: number;
  outcome: ReviewOutcome;
  tier?: string;
  profileName?: string;
  error?: string;
  durationMs: number;
}

export interface ReviewActivity {
  current: { workspaceId: string; startedAt: number; taskId: string } | null;
  queueDepth: number;
  recent: ReviewRecentEntry[];
  lastScan: { at: number; dirtyCount: number } | null;
}

const RECENT_MAX = 15;
let current: ReviewActivity['current'] = null;
const recent: ReviewRecentEntry[] = [];
let lastScan: ReviewActivity['lastScan'] = null;

/** 由 worker result + error 判定结果类别（纯函数，可单测） */
export function classifyReviewOutcome(result: any, error?: string): ReviewOutcome {
  if (error || result?.error) return 'error';
  return result?.saved ? 'saved' : 'no-card';
}

export function getReviewActivity(): ReviewActivity {
  return {
    current,
    queueDepth: queue.length + inFlight.size,
    recent: recent.slice(),
    lastScan,
  };
}

function key(w: StaleWorkspace): string {
  return w.workspaceId;
}

/** 入队（去重）并启动串行泵 */
export function enqueueReviews(items: StaleWorkspace[]): void {
  for (const w of items) {
    const k = key(w);
    if (inFlight.has(k)) continue;
    inFlight.add(k);
    queue.push(w);
  }
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const w = queue.shift()!;
      try {
        await runOne(w);
      } catch (err) {
        mainLogger.warn('[review] 复盘任务异常:', key(w), err);
      } finally {
        inFlight.delete(key(w));
      }
    }
  } finally {
    pumping = false;
  }
}

async function runOne(w: StaleWorkspace): Promise<void> {
  const startedAt = Date.now();

  const pushRecent = (outcome: ReviewOutcome, extra: Partial<ReviewRecentEntry>) => {
    recent.unshift({
      workspaceId: w.workspaceId,
      finishedAt: Date.now(),
      outcome,
      durationMs: Date.now() - startedAt,
      ...extra,
    });
    if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
    current = null;
  };

  const task: AgentTask = {
    id: `review-${w.workspaceId}-${Date.now()}`,
    type: TaskType.REVIEW_SESSION,
    status: TaskStatus.PENDING,
    payload: {
      workspaceId: w.workspaceId,
      workspacePath: w.workspacePath,
    } as ReviewSessionPayload,
    createdAt: Date.now(),
  };
  current = { workspaceId: w.workspaceId, startedAt, taskId: task.id };

  const { getAgentManager } = await import('../../agents/agent-manager.js');
  await new Promise<void>((resolve) => {
    getAgentManager().submitTask(task, (_taskId, status, result, error) => {
      if (
        status === TaskStatus.COMPLETED ||
        status === TaskStatus.FAILED ||
        status === TaskStatus.CANCELLED
      ) {
        const outcome = status === TaskStatus.CANCELLED ? 'error' : classifyReviewOutcome(result, error);
        pushRecent(outcome, {
          tier: result?.tier,
          profileName: result?.profileName,
          error: error ?? result?.error ?? (status === TaskStatus.CANCELLED ? '已取消' : undefined),
        });
        if (outcome === 'no-card') {
          void touchReportUpdatedAt(w.workspaceId).catch((err) =>
            mainLogger.warn('[review] no-card touch dashboard 失败:', key(w), err));
        }
        resolve();
      }
    }).catch((err) => {
      mainLogger.warn('[review] 提交复盘任务失败:', key(w), err);
      pushRecent('error', { error: String(err) });
      resolve();
    });
  });
}

/** 触发点①/②：全量过时检查 → 入队 */
export async function triggerReviewScan(): Promise<void> {
  await whenMigrationReady();
  try {
    const { findStaleWorkspaces } = await import('./review-scanner.js');
    const stale = await findStaleWorkspaces();
    lastScan = { at: Date.now(), dirtyCount: stale.length };
    if (stale.length) {
      mainLogger.info(`[review] 过时检查发现 ${stale.length} 个工作区待复盘`);
      enqueueReviews(stale);
    }
  } catch (err) {
    mainLogger.warn('[review] 全量过时检查失败:', err);
  }
}

/** 手动触发：单个工作区 */
export async function triggerReview(workspaceId: string, workspacePath: string): Promise<void> {
  await whenMigrationReady();
  enqueueReviews([{ workspaceId, workspacePath }]);
}
