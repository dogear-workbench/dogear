import type { BrowserTaskMeta } from './browser-task-meta.js';
import { recordBrowserAction } from './browser-action-stream.js';
import { mainLogger } from '../../agents/logger.js';

const logger = mainLogger.child('human-intervention');

export type HumanInterventionReason = 'login_required' | 'verification_required' | 'guard_password' | 'guard_submit';

export type InterventionResult = 'approved' | 'denied';

export interface HumanInterventionRequest {
  id: string;
  tabId: string;
  reason: HumanInterventionReason;
  message: string;
  url: string | null;
  createdAt: number;
  /** true 时前端渲染「确认提交/拒绝」双按钮，resolve 带 result；缺省走「完成后继续」单分支，广播结构向后兼容 */
  confirmMode?: boolean;
  /** 用户双分支处理结果（确认/拒绝）；「完成后继续」单按钮与 auto 解除不填 */
  result?: InterventionResult;
}

interface PendingIntervention extends HumanInterventionRequest {
  taskMeta: BrowserTaskMeta;
}

type InterventionBroadcaster = (pending: HumanInterventionRequest[]) => void;
type InterventionWaiter = (outcome: InterventionWaitOutcome) => void;

export type InterventionWaitOutcome = InterventionResult | 'auto' | 'timeout' | 'missing';

const pendingById = new Map<string, PendingIntervention>();
const pendingIdByTab = new Map<string, string>();
const waitersById = new Map<string, Set<InterventionWaiter>>();
let broadcaster: InterventionBroadcaster | null = null;

export function setHumanInterventionBroadcaster(fn: InterventionBroadcaster | null): void {
  broadcaster = fn;
}

function toPublic(request: PendingIntervention): HumanInterventionRequest {
  const { taskMeta: _taskMeta, ...rest } = request;
  return rest;
}

function broadcast(): void {
  broadcaster?.(listPendingHumanInterventions());
}

function record(action: 'raised' | 'resolved', request: PendingIntervention | null, result?: InterventionResult): void {
  const resultNote = result ? (result === 'approved' ? '已确认' : '已拒绝') : '';
  recordBrowserAction({
    source: 'human_intervention',
    taskMeta: request?.taskMeta ?? { kind: 'agent' },
    action: 'await_human',
    url: request?.url ?? undefined,
    detail: request ? `${request.reason}${resultNote}：${request.message}` : action,
    result: action,
  });
}

/** 上报等待人工：同 tab 只保留最新一条（重复触发刷新时间与文案，不堆卡片） */
export function raiseHumanIntervention(input: {
  tabId: string;
  reason: HumanInterventionReason;
  message: string;
  url?: string | null;
  taskMeta?: BrowserTaskMeta;
  confirmMode?: boolean;
}): HumanInterventionRequest {
  const existingId = pendingIdByTab.get(input.tabId);
  const existing = existingId ? pendingById.get(existingId) : undefined;
  if (existingId && existing) {
    existing.reason = input.reason;
    existing.message = input.message;
    existing.url = input.url ?? existing.url;
    existing.createdAt = Date.now();
    if (input.confirmMode !== undefined) existing.confirmMode = input.confirmMode;
    delete existing.result;
    broadcast();
    return toPublic(existing);
  }
  const request: PendingIntervention = {
    id: `hi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tabId: input.tabId,
    reason: input.reason,
    message: input.message,
    url: input.url ?? null,
    createdAt: Date.now(),
    ...(input.confirmMode ? { confirmMode: true } : {}),
    taskMeta: input.taskMeta ?? { kind: 'agent' },
  };
  logger.warn(`人工等待上报: id=${request.id} tabId=${request.tabId} reason=${request.reason}`);
  pendingById.set(request.id, request);
  pendingIdByTab.set(request.tabId, request.id);
  record('raised', request);
  broadcast();
  return toPublic(request);
}

/** 工具层等待用户处理结果：resolve 时唤醒 waiter（timeout 兜底防永久挂起） */
export function waitForInterventionResult(id: string, timeoutMs: number): Promise<InterventionWaitOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: InterventionWaitOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const set = waitersById.get(id);
      if (set) {
        set.delete(waiter);
        if (set.size === 0) waitersById.delete(id);
      }
      resolve(outcome);
    };
    const waiter: InterventionWaiter = settle;
    const timer = setTimeout(() => settle('timeout'), timeoutMs);
    if (!pendingById.has(id)) {
      settle('missing');
      return;
    }
    let set = waitersById.get(id);
    if (!set) {
      set = new Set();
      waitersById.set(id, set);
    }
    set.add(waiter);
  });
}

function notifyWaiters(id: string, outcome: InterventionWaitOutcome): boolean {
  const set = waitersById.get(id);
  if (!set || set.size === 0) return false;
  waitersById.delete(id);
  for (const waiter of [...set]) waiter(outcome);
  return true;
}

/** 手动解除的完整返回：request 为公开形态（已剥 taskMeta），taskMeta 单独透出供 tipc 层唤醒 glue；waiterConsumed 时工具在等结果，tipc 层不再 resume 会话 */
export interface ResolvedIntervention {
  request: HumanInterventionRequest;
  taskMeta: BrowserTaskMeta;
  waiterConsumed: boolean;
}

export function resolveHumanIntervention(
  id: string,
  resolvedBy: 'user' | 'auto' = 'user',
  result?: InterventionResult,
): ResolvedIntervention | null {
  const request = pendingById.get(id);
  if (!request) return null;
  pendingById.delete(id);
  pendingIdByTab.delete(request.tabId);
  if (result) request.result = result;
  const outcome = result ?? (resolvedBy === 'auto' ? 'auto' : 'approved');
  const waiterConsumed = notifyWaiters(id, outcome);
  // WARN 级别才会落盘；人工确认解除是低频安全审计点，需事后可查
  logger.warn(`人工等待解除: id=${id} outcome=${outcome} waiterConsumed=${waiterConsumed} reason=${request.reason}`);
  record('resolved', request, result);
  broadcast();
  return { request: toPublic(request), taskMeta: request.taskMeta, waiterConsumed };
}

/** 状态恢复路径：wait_for 命中 / navigate 回到正常页面时，自动解除该 tab 的等待 */
export function resolveInterventionsForTab(tabId: string): void {
  const id = pendingIdByTab.get(tabId);
  if (id) resolveHumanIntervention(id, 'auto');
}

export function listPendingHumanInterventions(): HumanInterventionRequest[] {
  return [...pendingById.values()].sort((a, b) => a.createdAt - b.createdAt).map(toPublic);
}
