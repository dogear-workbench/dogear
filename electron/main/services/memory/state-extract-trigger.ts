// 状态卡读时同步的抽取触发编排：submitTask 编排 + in-flight 按组去重 + 动态 import agent-manager 避环
import { randomUUID } from 'node:crypto';
import { TaskStatus, TaskType, type AgentTask } from '../../agents/task-types.js';
import { getStaleConversations, type StaleConversation } from './background-store.js';
import { mainLogger } from '../../agents/logger.js';
import { reportDone, reportRunning } from '../background-activity-service.js';
import { appendHistoryEntry } from '../scheduler/run-history-store.js';
import type { RunHistoryEntry, RunHistoryStatus, RunTokens } from '../scheduler/types.js';

const logger = mainLogger.child('state-extract-trigger');

// 任务终态兜底上限：防 agent-manager 丢回调导致 in-flight 条目泄漏
const TASK_DEADLINE_MS = 120_000;

export interface EnsureGroupFreshResult {
  synced: boolean;
  timedOut: boolean;
}

interface ExtractTaskOutcome {
  ok: boolean;
  error?: string;
  processed?: number;
  failed?: number;
}

const inFlight = new Map<string, Promise<ExtractTaskOutcome>>();

function entryKey(wsId: string, groupId: string): string {
  return `${wsId}:${groupId}`;
}

function extractTaskName(title: string | null | undefined, groupId: string): string {
  const t = title?.trim();
  if (t) return `状态抽取 · ${t}`;
  const bare = groupId.startsWith('group_') ? groupId.slice('group_'.length) : groupId;
  return `状态抽取 · ${bare.slice(0, 8)}`;
}

function extractRunTokens(result: any): RunTokens | undefined {
  const t = result?.tokens;
  if (!t || typeof t.inputTokens !== 'number' || typeof t.outputTokens !== 'number') return undefined;
  return {
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    cacheReadInputTokens: t.cacheReadInputTokens,
    cacheCreationInputTokens: t.cacheCreationInputTokens,
  };
}

function buildExtractSummary(status: TaskStatus, result: any): string {
  const processed = Number(result?.processed ?? 0);
  const skipped = Number(result?.skipped ?? 0);
  const failed = Number(result?.failed ?? 0);
  const head = `${status === TaskStatus.CANCELLED ? '已取消，' : ''}处理 ${processed + skipped + failed} 会话：成功 ${processed}，跳过 ${skipped}，失败 ${failed}`;
  const failures: Array<{ conversationId: string; error: string }> = Array.isArray(result?.failures)
    ? result.failures
    : [];
  const lines = failures.map((f) => {
    const reason = String(f?.error ?? '').split('\n')[0].slice(0, 200);
    return `- ${f?.conversationId}: ${reason}`;
  });
  return [head, ...lines].join('\n');
}

// 先写历史再 reportDone（UI 轮询视角 done 即历史可见）；写历史失败不影响任务本身
async function recordExtractRun(task: AgentTask, taskName: string, status: TaskStatus, result: any, error?: string): Promise<void> {
  let historyStatus: RunHistoryStatus;
  let historyError: string | undefined;
  if (status === TaskStatus.CANCELLED) {
    historyStatus = 'cancelled';
  } else if (status === TaskStatus.FAILED) {
    historyStatus = 'failed';
    historyError = error ?? `任务终态 ${status}`;
  } else if (result?.error) {
    historyStatus = 'failed';
    historyError = String(result.error);
  } else {
    historyStatus = 'completed';
  }
  const now = Date.now();
  const entry: RunHistoryEntry = {
    id: randomUUID(),
    ts: now,
    planId: task.id,
    planName: taskName,
    source: 'state-extract',
    kind: 'task',
    status: historyStatus,
    triggerReason: 'condition',
    startedAt: task.createdAt,
    endedAt: now,
    summary: buildExtractSummary(status, result),
    error: historyError,
    tokens: extractRunTokens(result),
  };
  try {
    await appendHistoryEntry(entry);
  } catch (err) {
    logger.warn('写状态抽取执行历史失败:', err);
  }
  try {
    reportDone(task.id);
  } catch (err) {
    logger.warn('清理状态抽取运行注册表失败:', err);
  }
}

function submitExtractTask(
  wsId: string,
  groupId: string,
  conversations: StaleConversation[],
): Promise<ExtractTaskOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const deadline = setTimeout(
      () => finish({ ok: false, error: '抽取任务终态等待超时' }),
      TASK_DEADLINE_MS,
    );
    deadline.unref?.();
    const finish = (r: ExtractTaskOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(r);
    };

    const task: AgentTask = {
      id: `state-extract-${groupId}-${Date.now()}`,
      type: TaskType.STATE_EXTRACT,
      status: TaskStatus.PENDING,
      payload: { workspaceId: wsId, groupId, conversations },
      createdAt: Date.now(),
    };

    void (async () => {
      let taskName = extractTaskName(undefined, groupId);
      try {
        const { getGroup } = await import('../group-service.js');
        const group = await getGroup(wsId, groupId);
        taskName = extractTaskName(group?.title, groupId);
      } catch (err) {
        logger.warn('查询组标题失败，历史任务名回退 groupId:', err);
      }
      reportRunning(task.id, { source: 'state-extract', name: taskName });
      try {
        const { getAgentManager } = await import('../../agents/agent-manager.js');
        await getAgentManager().submitTask(task, (_taskId, status, result, error) => {
          if (
            status !== TaskStatus.COMPLETED &&
            status !== TaskStatus.FAILED &&
            status !== TaskStatus.CANCELLED
          ) {
            return;
          }
          if (status !== TaskStatus.COMPLETED) {
            finish({ ok: false, error: error ?? `任务终态 ${status}` });
          } else {
            finish({
              ok: !result?.error,
              error: result?.error ? String(result.error) : undefined,
              processed: result?.processed,
              failed: result?.failed,
            });
          }
          void recordExtractRun(task, taskName, status, result, error);
        });
      } catch (err) {
        finish({ ok: false, error: String(err) });
        try {
          reportDone(task.id);
        } catch (e) {
          logger.warn('清理状态抽取运行注册表失败:', e);
        }
      }
    })();
  });
}

function trackInFlight(key: string, p: Promise<ExtractTaskOutcome>): void {
  inFlight.set(key, p);
  void p.then(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
}

function waitOrTimeout(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    t.unref?.();
  });
}

/**
 * 读时同步：有未提炼会话则复用/提交抽取任务并等待至多 timeoutMs。
 * 永不抛错；超时/失败返回 synced=false，任务留在后台可被后续调用复用。
 */
export async function ensureGroupFresh(
  wsId: string,
  groupId: string,
  timeoutMs: number,
  excludeConversationId?: string,
): Promise<EnsureGroupFreshResult> {
  try {
    const stale = await getStaleConversations(wsId, groupId, excludeConversationId);
    if (!stale.length) return { synced: true, timedOut: false };

    const key = entryKey(wsId, groupId);
    const existing = inFlight.get(key);
    const p = existing ?? submitExtractTask(wsId, groupId, stale);
    if (!existing) trackInFlight(key, p);

    const r = await Promise.race([p, waitOrTimeout(timeoutMs)]);
    if (r === 'timeout') {
      logger.warn(`读时同步等待超时（${timeoutMs}ms），任务留后台继续: ${key}`);
      return { synced: false, timedOut: true };
    }
    if (!r.ok) {
      logger.warn(`读时同步抽取失败: ${key} ${r.error ?? ''}`);
      return { synced: false, timedOut: false };
    }
    logger.info(`读时同步抽取完成: ${key} processed=${r.processed ?? 0} failed=${r.failed ?? 0}`);
    return { synced: true, timedOut: false };
  } catch (err) {
    logger.warn(`读时同步失败（不抛错）: ws=${wsId} gid=${groupId}`, err);
    return { synced: false, timedOut: false };
  }
}
