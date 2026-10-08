import type { BrowserTaskMeta } from './browser-task-meta.js';
import { recordBrowserAction } from './browser-action-stream.js';
import { mainLogger } from '../../agents/logger.js';

const logger = mainLogger.child('human-intervention');

export type HumanInterventionReason =
  | 'login_required'
  | 'verification_required'
  | 'guard_password'
  | 'guard_submit'
  | 'extension_wait';

export type InterventionResult = 'approved' | 'denied' | 'manual';

export interface HumanInterventionAction {
  key: string;
  label: string;
  tone?: 'primary' | 'destructive';
}

export interface HumanInterventionRequest {
  id: string;
  tabId: string;
  reason: HumanInterventionReason;
  message: string;
  url: string | null;
  createdAt: number;
  /** true 时前端渲染「确认执行/拒绝/已手动操作」三按钮，resolve 带 result；缺省走「完成后继续」单分支，广播结构向后兼容 */
  confirmMode?: boolean;
  /** 卡片插入的目标会话 id（扩展工具执行上下文携带）；缺省不进会话消息流，仅伴随面板横幅 */
  conversationId?: string;
  /** 会话卡片按钮组；缺省按 reason 渲染默认按钮组 */
  actions?: HumanInterventionAction[];
  /** 用户处理结果（确认/拒绝/已手动操作）；「完成后继续」单按钮与 auto 解除不填 */
  result?: InterventionResult;
  /** 完整解除结果（含 auto/timeout/missing），供会话卡片渲染 resolved 态文案 */
  outcome?: InterventionWaitOutcome;
  /** 触发解除的按钮 key（denied 时区分 skip/block 等副作用） */
  actionKey?: string;
}

/** actionKey → 工具层 outcome 映射；未命中的 key（如 go_page）由调用方做副作用后自行决定是否解除 */
const ACTION_KEY_OUTCOMES: Record<string, InterventionResult> = {
  approved: 'approved',
  denied: 'denied',
  manual: 'manual',
  done: 'approved',
  skip: 'denied',
  block: 'denied',
  cancel: 'denied',
};

export function outcomeForActionKey(actionKey: string): InterventionResult | null {
  return ACTION_KEY_OUTCOMES[actionKey] ?? null;
}

interface PendingIntervention extends HumanInterventionRequest {
  taskMeta: BrowserTaskMeta;
}

type InterventionBroadcaster = (pending: HumanInterventionRequest[], resolved?: HumanInterventionRequest) => void;

export type InterventionWaitOutcome = InterventionResult | 'auto' | 'timeout' | 'missing';

export interface InterventionWaitResult {
  outcome: InterventionWaitOutcome;
  /** 解除时的请求快照（含 actionKey）；missing 或超时无挂起时为 null */
  request: HumanInterventionRequest | null;
}

type InterventionWaiter = (result: InterventionWaitResult) => void;

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

function broadcast(resolved?: HumanInterventionRequest): void {
  broadcaster?.(listPendingHumanInterventions(), resolved);
}

const RESULT_NOTES: Record<InterventionResult, string> = {
  approved: '已确认',
  denied: '已拒绝',
  manual: '已手动操作',
};

function record(action: 'raised' | 'resolved', request: PendingIntervention | null, result?: InterventionResult): void {
  const resultNote = result ? RESULT_NOTES[result] : '';
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
  conversationId?: string;
  actions?: HumanInterventionAction[];
}): HumanInterventionRequest {
  const existingId = pendingIdByTab.get(input.tabId);
  const existing = existingId ? pendingById.get(existingId) : undefined;
  if (existingId && existing) {
    existing.reason = input.reason;
    existing.message = input.message;
    existing.url = input.url ?? existing.url;
    existing.createdAt = Date.now();
    if (input.confirmMode !== undefined) existing.confirmMode = input.confirmMode;
    if (input.conversationId !== undefined) existing.conversationId = input.conversationId;
    if (input.actions !== undefined) existing.actions = input.actions;
    delete existing.result;
    delete existing.outcome;
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
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.actions ? { actions: input.actions } : {}),
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
export function waitForInterventionResult(id: string, timeoutMs: number): Promise<InterventionWaitResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: InterventionWaitResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const set = waitersById.get(id);
      if (set) {
        set.delete(waiter);
        if (set.size === 0) waitersById.delete(id);
      }
      resolve(result);
      // 超时收口：工具侧不再等待但卡片还在时自动解除（广播 → 弹窗收起）；有并发 waiter 时不吞别人的等待
      if (result.outcome === 'timeout' && pendingById.has(id) && !waitersById.has(id)) {
        resolveHumanIntervention(id, 'auto', undefined, 'timeout');
      }
    };
    const waiter: InterventionWaiter = settle;
    const timer = setTimeout(() => {
      const pending = pendingById.get(id);
      settle({ outcome: 'timeout', request: pending ? toPublic(pending) : null });
    }, timeoutMs);
    if (!pendingById.has(id)) {
      settle({ outcome: 'missing', request: null });
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

function notifyWaiters(id: string, outcome: InterventionWaitOutcome, request: PendingIntervention): boolean {
  const set = waitersById.get(id);
  if (!set || set.size === 0) return false;
  waitersById.delete(id);
  const snapshot = toPublic(request);
  for (const waiter of [...set]) waiter({ outcome, request: snapshot });
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
  outcomeOverride?: InterventionWaitOutcome,
  actionKey?: string,
): ResolvedIntervention | null {
  const request = pendingById.get(id);
  if (!request) return null;
  pendingById.delete(id);
  pendingIdByTab.delete(request.tabId);
  if (actionKey) request.actionKey = actionKey;
  if (result) request.result = result;
  const outcome = result ?? outcomeOverride ?? (resolvedBy === 'auto' ? 'auto' : 'approved');
  request.outcome = outcome;
  const waiterConsumed = notifyWaiters(id, outcome, request);
  // WARN 级别才会落盘；人工确认解除是低频安全审计点，需事后可查
  logger.warn(`人工等待解除: id=${id} outcome=${outcome} waiterConsumed=${waiterConsumed} reason=${request.reason}`);
  record('resolved', request, result);
  broadcast(toPublic(request));
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
