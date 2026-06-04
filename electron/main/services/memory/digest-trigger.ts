// 会话提炼触发编排：把脏会话转成 DIGEST_SESSION 任务，串行提交（并发=1）
// 提炼是后台、不赶时间，避免一次起几十个 query 烧钱卡机。
import {
  TaskType, TaskStatus, type AgentTask, type DigestSessionPayload,
} from '../../agents/task-types.js';
import type { DirtySession } from './digest-scanner.js';
import { mainLogger } from '../../agents/logger.js';

const inFlight = new Set<string>();
const queue: DirtySession[] = [];
let pumping = false;

export type DigestOutcome = 'saved' | 'no-card' | 'error';

export interface DigestRecentEntry {
  workspaceId: string;
  sessionId: string;
  finishedAt: number;
  outcome: DigestOutcome;
  tier?: string;
  profileName?: string;
  error?: string;
  durationMs: number;
}

export interface DigestActivity {
  current: { workspaceId: string; sessionId: string; startedAt: number } | null;
  queueDepth: number;
  recent: DigestRecentEntry[];
  lastScan: { at: number; dirtyCount: number } | null;
}

const RECENT_MAX = 15;
let current: DigestActivity['current'] = null;
const recent: DigestRecentEntry[] = [];
let lastScan: DigestActivity['lastScan'] = null;

/** 由 worker result + error 判定结果类别（纯函数，可单测） */
export function classifyOutcome(result: any, error?: string): DigestOutcome {
  if (error || result?.error) return 'error';
  return result?.saved ? 'saved' : 'no-card';
}

export function getDigestActivity(): DigestActivity {
  return {
    current,
    queueDepth: queue.length + inFlight.size,
    recent: recent.slice(),
    lastScan,
  };
}

function key(d: DirtySession): string {
  return `${d.workspaceId}:${d.sdkSessionId}`;
}

/** 入队（去重）并启动串行泵 */
export function enqueueDigests(sessions: DirtySession[]): void {
  for (const s of sessions) {
    const k = key(s);
    if (inFlight.has(k)) continue;
    inFlight.add(k);
    queue.push(s);
  }
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const d = queue.shift()!;
      try {
        await runOne(d);
      } catch (err) {
        mainLogger.warn('[digest] 提炼任务异常:', key(d), err);
      } finally {
        inFlight.delete(key(d));
      }
    }
  } finally {
    pumping = false;
  }
}

async function runOne(d: DirtySession): Promise<void> {
  const startedAt = Date.now();
  current = { workspaceId: d.workspaceId, sessionId: d.sdkSessionId, startedAt };

  const pushRecent = (outcome: DigestOutcome, extra: Partial<DigestRecentEntry>) => {
    recent.unshift({
      workspaceId: d.workspaceId,
      sessionId: d.sdkSessionId,
      finishedAt: Date.now(),
      outcome,
      durationMs: Date.now() - startedAt,
      ...extra,
    });
    if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
    current = null;
  };

  const task: AgentTask = {
    id: `digest-${d.sdkSessionId}-${Date.now()}`,
    type: TaskType.DIGEST_SESSION,
    status: TaskStatus.PENDING,
    payload: {
      workspaceId: d.workspaceId,
      workspacePath: d.workspacePath,
      sdkSessionId: d.sdkSessionId,
    } as DigestSessionPayload,
    createdAt: Date.now(),
  };

  const { getAgentManager } = await import('../../agents/agent-manager.js');
  await new Promise<void>((resolve) => {
    getAgentManager().submitTask(task, (_taskId, status, result, error) => {
      if (
        status === TaskStatus.COMPLETED ||
        status === TaskStatus.FAILED ||
        status === TaskStatus.CANCELLED
      ) {
        const outcome = status === TaskStatus.CANCELLED ? 'error' : classifyOutcome(result, error);
        pushRecent(outcome, {
          tier: result?.tier,
          profileName: result?.profileName,
          error: error ?? result?.error ?? (status === TaskStatus.CANCELLED ? '已取消' : undefined),
        });
        resolve();
      }
    }).catch((err) => {
      mainLogger.warn('[digest] 提交提炼任务失败:', key(d), err);
      pushRecent('error', { error: String(err) });
      resolve();
    });
  });
}

/** 触发点①/②：全量脏检查 → 入队 */
export async function triggerScanAll(): Promise<void> {
  try {
    const { scanAllWorkspaces } = await import('./digest-scanner.js');
    const dirty = await scanAllWorkspaces();
    lastScan = { at: Date.now(), dirtyCount: dirty.length };
    if (dirty.length) {
      mainLogger.info(`[digest] 脏检查发现 ${dirty.length} 个会话待提炼`);
      enqueueDigests(dirty);
    }
  } catch (err) {
    mainLogger.warn('[digest] 全量脏检查失败:', err);
  }
}

/**
 * 触发点③：关会话后只扫该会话所属工作区（mtime 比对很便宜，已提炼的不会重复入队）。
 * 传 conversationId 而非 sessionId：关会话时 session→conversation 映射可能已被清理，
 * 调用方应在关闭前捕获 conversationId 再传入。
 */
export async function triggerScanByConversation(convId: string): Promise<void> {
  try {
    const conversationService = await import('../conversation-service.js');
    const workspaceService = await import('../workspace-json-service.js');

    const found = await conversationService.getByIdGlobal(convId);
    if (!found) return;
    const ws = await workspaceService.getById(found.workspaceId);
    if (!ws) return;

    const { findDirtySessions } = await import('./digest-scanner.js');
    const dirty = await findDirtySessions(ws.id, ws.path);
    lastScan = { at: Date.now(), dirtyCount: dirty.length };
    if (dirty.length) enqueueDigests(dirty);
  } catch (err) {
    mainLogger.warn('[digest] 关会话脏检查失败:', err);
  }
}
