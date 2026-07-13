/**
 * Delegation Bridge — 主进程内 Agent 协作运行时
 * 维护会话创建/停止的状态机（childStates，用于 UI 展示 + no_delivery 检测）+
 * 通用消息投递与等待（messageWaiters，支撑 SendMessage / WaitForMessage）+
 * 监听 QueryBasedSession 的 session_init / complete / error 推进状态。
 */

import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';

import { QueryBasedSession, getQueryBasedSessionManager } from './query-based-session.js';
import { mainLogger } from './logger.js';
import * as conversationService from '../services/conversation-service.js';
import * as groupSharedService from '../services/group-shared-service.js';
import { loadSettings } from '../services/settings-service.js';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';
import type {
  ChildStatus,
  ChildStateSnapshot,
  DelegateSpec,
} from '../types.js';

const logger = mainLogger.child('delegation-bridge');

interface ChildStateInternal extends ChildStateSnapshot {
  workspaceId: string;
  attachmentId: string;
  /** 本地运行时 sessionId（QueryBasedSessionManager 内部 key，非 SDK sdkSessionId） */
  sessionId: string;
  timeoutTimer?: NodeJS.Timeout;
}

export interface WaitForMessageResult {
  fromSessionId: string;
  message: string;
  delivery: boolean;
}

interface MessageWaiterInternal {
  id: string;
  ownerConversationId: string;
  fromSdkSessionIds: Set<string>;
  resolve: (result: WaitForMessageResult | null) => void;
  timer: NodeJS.Timeout;
}

const childStates = new Map<string, ChildStateInternal>();
const messageWaiters = new Map<string, MessageWaiterInternal>();
const sdkSessionIdWaiters = new Map<string, Array<(sdkSessionId: string) => void>>();

// ─── 事件广播 helpers ───

function broadcastChildStatusChanged(parentConversationId: string, childId: string, status: ChildStatus, snapshot: ChildStateSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      getRendererHandlers<RendererHandlers>(win.webContents).childStatusChanged.send({
        parentConversationId, childId, status, snapshot,
      });
    } catch (err) {
      logger.warn('broadcastChildStatusChanged failed', err);
    }
  }
}

function broadcastConversationListChanged(workspaceId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      getRendererHandlers<RendererHandlers>(win.webContents).conversationListChanged.send({ workspaceId });
    } catch (err) {
      logger.warn('broadcastConversationListChanged failed', err);
    }
  }
}

function broadcastDeliveriesAwaitChanged(parentConversationId: string): void {
  let runningCount = 0;
  let doneCount = 0;
  for (const c of childStates.values()) {
    if (c.parentConversationId !== parentConversationId) continue;
    if (c.status === 'running') runningCount++;
    else if (c.status === 'done') doneCount++;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      getRendererHandlers<RendererHandlers>(win.webContents).deliveriesAwaitChanged.send({
        parentConversationId, runningCount, doneCount,
      });
    } catch (err) {
      logger.warn('broadcastDeliveriesAwaitChanged failed', err);
    }
  }
}

function toSnapshot(c: ChildStateInternal): ChildStateSnapshot {
  return {
    childId: c.childId,
    parentConversationId: c.parentConversationId,
    groupId: c.groupId,
    outputPath: c.outputPath,
    task: c.task,
    title: c.title,
    status: c.status,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    summary: c.summary,
    errorMessage: c.errorMessage,
    sdkSessionId: c.sdkSessionId,
  };
}

function isTerminal(status: ChildStatus): boolean {
  return status !== 'running';
}

// ─── session 事件 wiring ───

function wireSession(childId: string, session: QueryBasedSession): void {
  session.on('complete', () => onSessionComplete(childId));
  session.on('error', (msg: unknown) => onSessionError(childId, msg));
  session.on('session_init', (data: { session_id: string }) => onChildSessionInit(childId, data.session_id));
  // session_init 理论上在 wireSession 之后才会触发；这里做一次同步兜底，覆盖极小概率的时序竞争
  const existing = session.getSdkSessionId();
  if (existing) onChildSessionInit(childId, existing);
}

function onChildSessionInit(childId: string, sdkSessionId: string): void {
  const c = childStates.get(childId);
  if (!c || c.sdkSessionId) return;
  c.sdkSessionId = sdkSessionId;
  const resolvers = sdkSessionIdWaiters.get(childId);
  if (resolvers) {
    sdkSessionIdWaiters.delete(childId);
    for (const resolve of resolvers) resolve(sdkSessionId);
  }
}

function onSessionComplete(childId: string): void {
  const c = childStates.get(childId);
  if (!c || c.status !== 'running') return;
  // 会话自然停了但没调 SendMessage(delivery:true) 交付
  c.status = 'no_delivery';
  c.finishedAt = Date.now();
  c.errorMessage = '会话结束但未交付';
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
}

function onSessionError(childId: string, msg: unknown): void {
  const c = childStates.get(childId);
  if (!c || c.status !== 'running') return;
  c.status = 'failed';
  c.finishedAt = Date.now();
  c.errorMessage = extractErrorMessage(msg);
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
}

function extractErrorMessage(msg: unknown): string {
  if (typeof msg === 'string') return msg;
  if (msg && typeof msg === 'object') {
    const m = msg as Record<string, unknown>;
    if (typeof m.error === 'string') return m.error;
    if (typeof m.message === 'string') return m.message;
  }
  return '未知错误';
}

// ─── 创建 / 停止会话 ───

export interface StartChildOptions {
  parentConversationId: string;
  workspaceId: string;
  groupId: string;
  spec: DelegateSpec;
}

export async function startChild(opts: StartChildOptions): Promise<ChildStateSnapshot> {
  const { parentConversationId, workspaceId, groupId, spec } = opts;

  const settings = await loadSettings();
  const parent = await conversationService.getById(workspaceId, parentConversationId);
  if (!parent) throw new Error(`发起会话 ${parentConversationId} 不存在`);

  const modelSel = settings.subAgent?.modelSelection
    ?? parent.modelSelection
    ?? settings.ai.defaultModelSelection
    ?? null;

  const title = spec.title ?? `子会话: ${spec.task.slice(0, 30)}`;

  if (!parent.sdkSessionId) {
    logger.warn(`发起会话 ${parentConversationId} 尚无 sdkSessionId，新会话 ${title} 将不写入 contractMetadata（无法溯源派出者）`);
  }
  const contractMetadata: conversationService.ContractMetadata | undefined = parent.sdkSessionId
    ? {
        parentSessionId: parent.sdkSessionId,
        task: spec.task,
        expectedOutputPath: spec.outputPath,
        createdBy: 'agent',
      }
    : undefined;

  // 先建 conversation 拿到 childId
  const childId = await conversationService.create(workspaceId, groupId, title, modelSel, {
    role: 'sub',
    parentConversationId,
    cachePolicy: settings.subAgent?.cachePolicy ?? '5m',
    contractMetadata,
  });
  broadcastConversationListChanged(workspaceId);

  // claim outputPath，失败则回滚
  const claim = await groupSharedService.claimOutputPath(workspaceId, groupId, spec.outputPath, childId);
  if (!claim.ok) {
    try { await conversationService.deleteConversation(workspaceId, childId); } catch (err) { logger.warn('回滚 conversation 失败', err); }
    if (claim.reason === 'file_exists') {
      throw new Error(`outputPath "${spec.outputPath}" 对应文件已存在`);
    }
    throw new Error(`outputPath "${spec.outputPath}" 已被子会话 ${claim.holderChildId} 占用`);
  }

  // 先注册占位 state（attach 内部会调 buildConversationSessionConfig → getChildSnapshot
  // 来读 task/outputPath 组装 subAgent 段，必须在 attach 之前可见）
  const now = Date.now();
  const state: ChildStateInternal = {
    childId,
    parentConversationId,
    groupId,
    outputPath: spec.outputPath,
    task: spec.task,
    title,
    status: 'running',
    startedAt: now,
    workspaceId,
    attachmentId: '',
    sessionId: '',
  };
  childStates.set(childId, state);

  // attach 拉起 session
  let attachment: Awaited<ReturnType<typeof conversationRuntimeService.attachConversation>>;
  try {
    attachment = await conversationRuntimeService.attachConversation(childId, workspaceId, 'desktop', {});
  } catch (err) {
    childStates.delete(childId);
    groupSharedService.releaseOutputPath(workspaceId, groupId, spec.outputPath, childId);
    try { await conversationService.deleteConversation(workspaceId, childId); } catch { /* ignore */ }
    throw err;
  }

  const session = getQueryBasedSessionManager().getSession(attachment.sessionId);
  if (!session) {
    childStates.delete(childId);
    groupSharedService.releaseOutputPath(workspaceId, groupId, spec.outputPath, childId);
    try { conversationRuntimeService.detachAttachment(attachment.attachmentId); } catch { /* ignore */ }
    throw new Error(`session 拉起失败: ${attachment.sessionId}`);
  }

  state.attachmentId = attachment.attachmentId;
  state.sessionId = attachment.sessionId;

  const timeoutMs = (settings.subAgent?.timeoutMinutes ?? 30) * 60_000;
  state.timeoutTimer = setTimeout(() => { void stopChild(childId, 'timeout'); }, timeoutMs);

  wireSession(childId, session);

  broadcastChildStatusChanged(parentConversationId, childId, 'running', toSnapshot(state));
  broadcastDeliveriesAwaitChanged(parentConversationId);

  // fire-and-forget 发任务
  session.sendMessage(spec.task).catch((err: unknown) => {
    logger.error(`子会话 ${childId} sendMessage 失败`, err);
    onSessionError(childId, err);
  });

  return toSnapshot(state);
}

export async function stopChild(childId: string, reason: 'cancelled' | 'timeout' = 'cancelled'): Promise<void> {
  const c = childStates.get(childId);
  if (!c) return;
  if (isTerminal(c.status)) return;

  c.status = reason;
  c.finishedAt = Date.now();
  c.errorMessage = reason === 'timeout' ? '超时中断' : '被停止';
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }

  const session = getQueryBasedSessionManager().getSession(c.sessionId);
  if (session) {
    try { await session.interrupt(); } catch (err) { logger.warn(`session.interrupt 失败 ${childId}`, err); }
  }
  try { conversationRuntimeService.detachAttachment(c.attachmentId); } catch (err) { logger.warn(`detachAttachment 失败 ${childId}`, err); }

  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);

  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
}

/**
 * 标记某个会话已通过 SendMessage(delivery:true) 完成交付（由 delegation-tools 调用）。
 * 只对仍处于 running 状态的会话生效，幂等安全。
 */
export function markChildDelivered(childId: string, summary: string): void {
  const c = childStates.get(childId);
  if (!c || c.status !== 'running') return;
  c.status = 'done';
  c.summary = summary;
  c.finishedAt = Date.now();
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, 'done', toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
}

export function getChildrenByParent(parentConversationId: string): ChildStateSnapshot[] {
  const out: ChildStateSnapshot[] = [];
  for (const c of childStates.values()) {
    if (c.parentConversationId === parentConversationId) out.push(toSnapshot(c));
  }
  return out;
}

export function getChildSnapshot(childId: string): ChildStateSnapshot | null {
  const c = childStates.get(childId);
  return c ? toSnapshot(c) : null;
}

export function getAllChildren(): ChildStateSnapshot[] {
  return Array.from(childStates.values()).map(toSnapshot);
}

export async function previewClaim(
  workspaceId: string,
  groupId: string,
  relPaths: string[],
): Promise<{ ok: true } | { ok: false; conflicts: groupSharedService.PreviewClaimConflict[] }> {
  return groupSharedService.previewClaim(workspaceId, groupId, relPaths);
}

/**
 * 在 parentConversationId 派出的子会话中，按子会话自身的 sdkSessionId 反查 childId。
 * 只在「我派出的」范围内查找，防止越权操作别人的子会话。
 */
export function getChildIdBySessionId(parentConversationId: string, sessionId: string): string | null {
  for (const c of childStates.values()) {
    if (c.parentConversationId === parentConversationId && c.sdkSessionId === sessionId) {
      return c.childId;
    }
  }
  return null;
}

/**
 * 子会话反查「派出自己的会话」的 sdkSessionId（子 → 父方向）。
 */
export async function getParentSessionIdByChildConversationId(childConversationId: string): Promise<string | null> {
  const c = childStates.get(childConversationId);
  if (!c) return null;
  const parent = await conversationService.getById(c.workspaceId, c.parentConversationId);
  return parent?.sdkSessionId ?? null;
}

/**
 * 等待某个刚创建的子会话拿到自己的 sdkSessionId（session_init 是异步到达的）。
 * 超时返回 null，调用方应引导 agent 之后用 ListLinkedSessions 兜底查询。
 */
export function waitForChildSdkSessionId(childId: string, timeoutMs = 15000): Promise<string | null> {
  const c = childStates.get(childId);
  if (!c) return Promise.resolve(null);
  if (c.sdkSessionId) return Promise.resolve(c.sdkSessionId);

  return new Promise((resolve) => {
    let settled = false;
    const wrapped = (sdkSessionId: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(sdkSessionId);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const list = sdkSessionIdWaiters.get(childId);
      if (list) {
        const idx = list.indexOf(wrapped);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) sdkSessionIdWaiters.delete(childId);
      }
      resolve(null);
    }, timeoutMs);
    const list = sdkSessionIdWaiters.get(childId) ?? [];
    list.push(wrapped);
    sdkSessionIdWaiters.set(childId, list);
  });
}

// ─── 通用消息投递 / 等待（SendMessage / WaitForMessage 的运行时支撑） ───

/**
 * 挂起等待来自指定 sdkSessionId 集合中任意一方的下一条消息。
 * 超时返回 null。同一 ownerConversationId 允许有多个并行等待（不同 waiterId）。
 */
export function waitForMessage(
  ownerConversationId: string,
  fromSdkSessionIds: string[],
  timeoutMs: number,
): Promise<WaitForMessageResult | null> {
  return new Promise((resolve) => {
    const id = uuidv4();
    const timer = setTimeout(() => {
      messageWaiters.delete(id);
      resolve(null);
    }, timeoutMs);
    messageWaiters.set(id, {
      id,
      ownerConversationId,
      fromSdkSessionIds: new Set(fromSdkSessionIds),
      resolve,
      timer,
    });
  });
}

export interface DeliverMessageOptions {
  toConversationId: string;
  fromSessionId: string;
  fromLabel: string;
  message: string;
  delivery: boolean;
}

/**
 * 'waiter'：目标正在 WaitForMessage 挂起，消息直接送进它的等待结果
 * 'queued'：目标当前没有挂起等待，消息作为一条新输入推进目标会话的下一轮
 * 'target_inactive'：目标会话当前未运行（未打开/已关闭），消息未能送达
 */
export type DeliverMessageOutcome = 'waiter' | 'queued' | 'target_inactive';

export function deliverMessage(opts: DeliverMessageOptions): DeliverMessageOutcome {
  for (const [id, w] of messageWaiters) {
    if (w.ownerConversationId === opts.toConversationId && w.fromSdkSessionIds.has(opts.fromSessionId)) {
      clearTimeout(w.timer);
      messageWaiters.delete(id);
      w.resolve({ fromSessionId: opts.fromSessionId, message: opts.message, delivery: opts.delivery });
      return 'waiter';
    }
  }

  const localSessionId = getQueryBasedSessionManager().getSessionIdByConversation(opts.toConversationId);
  const session = localSessionId ? getQueryBasedSessionManager().getSession(localSessionId) : undefined;
  if (!session) return 'target_inactive';

  const senderTag = `<sender kind="agent" session_id="${escapeXmlAttr(opts.fromSessionId)}" name="${escapeXmlAttr(opts.fromLabel)}" delivery="${opts.delivery ? 'true' : 'false'}"/>`;
  const text = `${senderTag}\n${opts.message}`;
  session.sendMessage(text).catch((err: unknown) => {
    logger.warn(`deliverMessage 推送失败 (${opts.toConversationId})`, err);
  });
  return 'queued';
}

/**
 * 中断指定发起会话的所有活跃 WaitForMessage 等待，并把它名下仍在跑的会话标记为取消。
 * 行为：不调用 session.interrupt（对方会话继续跑或自行结束；之后再交付会因父已放弃等待而只是普通推送）。
 */
export function abortWaitsForParent(parentConversationId: string): {
  abortedWaits: number;
  cancelledChildren: number;
} {
  let abortedWaits = 0;
  for (const [id, w] of messageWaiters) {
    if (w.ownerConversationId !== parentConversationId) continue;
    clearTimeout(w.timer);
    messageWaiters.delete(id);
    w.resolve(null);
    abortedWaits++;
  }

  let cancelledChildren = 0;
  for (const c of childStates.values()) {
    if (c.parentConversationId !== parentConversationId || c.status !== 'running') continue;
    c.status = 'cancelled';
    c.finishedAt = Date.now();
    c.errorMessage = '发起会话中断了等待';
    if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
    groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, c.childId);
    broadcastChildStatusChanged(c.parentConversationId, c.childId, c.status, toSnapshot(c));
    cancelledChildren++;
  }
  if (abortedWaits > 0 || cancelledChildren > 0) {
    broadcastDeliveriesAwaitChanged(parentConversationId);
  }

  return { abortedWaits, cancelledChildren };
}

/** 转义 XML 属性值中的特殊字符 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
