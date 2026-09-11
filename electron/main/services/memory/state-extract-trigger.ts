// 开启会话时的状态卡抽取触发编排（唯一触发点，见 topic-state-card-design.md）
// 模式对齐 group-digest-trigger.ts：submitTask 编排 + in-flight 按组去重 + 动态 import agent-manager 避环
import { TaskStatus, TaskType, type AgentTask } from '../../agents/task-types.js';
import { getStaleConversations, type StaleConversation } from './background-store.js';
import { mainLogger } from '../../agents/logger.js';

const logger = mainLogger.child('state-extract-trigger');

// 任务终态兜底上限：防 agent-manager 丢回调导致 in-flight 条目泄漏
const TASK_DEADLINE_MS = 120_000;

export type StateExtractTriggerOutcome = 'fresh' | 'sync-failed' | 'async' | 'async-inflight';

export interface EnsureGroupFreshResult {
  synced: boolean;
  timedOut: boolean;
}

export interface StateExtractTriggerResult {
  outcome: StateExtractTriggerOutcome;
  /** 触发判定时的滞后会话数 */
  staleCount: number;
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
            return;
          }
          finish({
            ok: !result?.error,
            error: result?.error ? String(result.error) : undefined,
            processed: result?.processed,
            failed: result?.failed,
          });
        });
      } catch (err) {
        finish({ ok: false, error: String(err) });
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
 * 开启会话时的抽取触发点：stale 即提交后台抽取，不同步等待（读时同步由 ensureGroupFresh 承担）。
 * 永不抛错、永不阻塞会话开启。
 */
export async function triggerStateExtractForSessionStart(
  wsId: string,
  groupId: string,
): Promise<StateExtractTriggerResult> {
  try {
    const stale = await getStaleConversations(wsId, groupId);
    if (!stale.length) return { outcome: 'fresh', staleCount: 0 };

    const key = entryKey(wsId, groupId);
    if (inFlight.get(key)) {
      logger.info(`同组抽取已在后台进行，跳过重复提交: ${key}`);
      return { outcome: 'async-inflight', staleCount: stale.length };
    }
    trackInFlight(key, submitExtractTask(wsId, groupId, stale));
    logger.info(`后台抽取已提交（${stale.length} 个滞后会话）: ${key}`);
    return { outcome: 'async', staleCount: stale.length };
  } catch (err) {
    logger.warn(`触发状态抽取失败（不阻塞会话开启）: ws=${wsId} gid=${groupId}`, err);
    return { outcome: 'sync-failed', staleCount: 0 };
  }
}

/**
 * 读时同步：有未提炼会话则复用/提交抽取任务并等待至多 timeoutMs。
 * 永不抛错；超时/失败返回 synced=false，任务留在后台可被后续调用复用。
 */
export async function ensureGroupFresh(
  wsId: string,
  groupId: string,
  timeoutMs: number,
): Promise<EnsureGroupFreshResult> {
  try {
    const stale = await getStaleConversations(wsId, groupId);
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
