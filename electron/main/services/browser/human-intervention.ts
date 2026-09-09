import type { BrowserTaskMeta } from './browser-task-meta.js';
import { recordBrowserAction } from './browser-action-stream.js';

export type HumanInterventionReason = 'login_required' | 'verification_required' | 'guard_password' | 'guard_submit';

export interface HumanInterventionRequest {
  id: string;
  tabId: string;
  reason: HumanInterventionReason;
  message: string;
  url: string | null;
  createdAt: number;
}

interface PendingIntervention extends HumanInterventionRequest {
  taskMeta: BrowserTaskMeta;
}

type InterventionBroadcaster = (pending: HumanInterventionRequest[]) => void;

const pendingById = new Map<string, PendingIntervention>();
const pendingIdByTab = new Map<string, string>();
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

function record(action: 'raised' | 'resolved', request: PendingIntervention | null): void {
  recordBrowserAction({
    source: 'human_intervention',
    taskMeta: request?.taskMeta ?? { kind: 'agent' },
    action: 'await_human',
    url: request?.url ?? undefined,
    detail: request ? `${request.reason}：${request.message}` : action,
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
}): HumanInterventionRequest {
  const existingId = pendingIdByTab.get(input.tabId);
  const existing = existingId ? pendingById.get(existingId) : undefined;
  if (existingId && existing) {
    existing.reason = input.reason;
    existing.message = input.message;
    existing.url = input.url ?? existing.url;
    existing.createdAt = Date.now();
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
    taskMeta: input.taskMeta ?? { kind: 'agent' },
  };
  pendingById.set(request.id, request);
  pendingIdByTab.set(request.tabId, request.id);
  record('raised', request);
  broadcast();
  return toPublic(request);
}

export function resolveHumanIntervention(id: string, resolvedBy: 'user' | 'auto' = 'user'): boolean {
  const request = pendingById.get(id);
  if (!request) return false;
  pendingById.delete(id);
  pendingIdByTab.delete(request.tabId);
  record('resolved', request);
  broadcast();
  return true;
}

/** 状态恢复路径：wait_for 命中 / navigate 回到正常页面时，自动解除该 tab 的等待 */
export function resolveInterventionsForTab(tabId: string): void {
  const id = pendingIdByTab.get(tabId);
  if (id) resolveHumanIntervention(id, 'auto');
}

export function listPendingHumanInterventions(): HumanInterventionRequest[] {
  return [...pendingById.values()].sort((a, b) => a.createdAt - b.createdAt).map(toPublic);
}
