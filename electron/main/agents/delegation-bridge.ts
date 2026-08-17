/**
 * Delegation Bridge — 主进程内 Agent 协作运行时
 * 维护会话创建/停止的状态机（childStates，用于 UI 展示 + no_delivery 检测）+
 * 通用消息投递与等待（messageWaiters，支撑 SendMessage / WaitForMessage）+
 * 监听 PiSession 的 complete / error 事件推进状态。
 */

import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';

import type { PiSession, PiSessionTurnResult } from './pi-session/pi-session.js';
import { classifyChildCompletion } from './delegation-lifecycle.js';
import { getPiSessionManager } from './pi-session/pi-session-manager.js';
import { mainLogger } from './logger.js';
import * as conversationService from '../services/conversation-service.js';
import { requireActiveGroup } from '../services/group-service.js';
import * as groupSharedService from '../services/group-shared-service.js';
import { loadSettings } from '../services/settings-service.js';
import { createDefaultSubAgentProfile } from '../services/settings-types.js';
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
  /** 该会话自身的 Harness sessionId；attachConversation 完成后立即同步赋值 */
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
const sessionIdWaiters = new Map<string, Array<(sessionId: string) => void>>();

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
    sessionId: c.sessionId,
  };
}

function isTerminal(status: ChildStatus): boolean {
  return status !== 'running';
}

// ─── session 事件 wiring ───

function wireSession(childId: string, session: PiSession): void {
  session.on('complete', (result: PiSessionTurnResult) => onSessionComplete(childId, result));
  // PiSession 在 attachConversation 返回前已 start() 完成，getHarnessSessionId() 此时必定有值，
  // 这是常态路径而非兜底（PiSession 不 emit session_init 事件）
  const existing = session.getHarnessSessionId();
  if (existing) onChildSessionInit(childId, existing);
}

function onChildSessionInit(childId: string, sessionId: string): void {
  const c = childStates.get(childId);
  if (!c || c.sessionId) return;
  c.sessionId = sessionId;
  const resolvers = sessionIdWaiters.get(childId);
  if (resolvers) {
    sessionIdWaiters.delete(childId);
    for (const resolve of resolvers) resolve(sessionId);
  }
}

/**
 * 结构化 complete 是本会话这一轮 prompt() 真正跑完的信号，是唯一安全的资源释放时机——
 * markChildDelivered 发生在 SendMessage 工具调用中途（prompt() 仍在执行），此时 detach 会
 * 触发 release() 归零后立即 close()/abort() 正在跑的这一轮，绝不能在那里做。
 * 状态只在仍是 'running' 时才改写（保留"是否曾经交付"的语义），但 detach 无论如何都要执行一次——
 * 哪怕 markChildDelivered/stopChild 已经改过 status，也可能还没释放过 attachment（如已释放，
 * detachAttachment 本身幂等，重复调用是安全 no-op）。
 */
function onSessionComplete(childId: string, result: PiSessionTurnResult): void {
  const c = childStates.get(childId);
  if (!c) return;
  if (c.status === 'running') {
    const completion = classifyChildCompletion(result);
    c.status = completion.status;
    c.errorMessage = completion.errorMessage;
    c.finishedAt = Date.now();
    groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
    broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
    broadcastDeliveriesAwaitChanged(c.parentConversationId);
  }
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  if (c.attachmentId) conversationRuntimeService.detachAttachment(c.attachmentId);
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '未知错误';
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
  if (!parent.groupId || parent.groupId !== groupId) throw new Error('子会话必须创建在发起会话所属的话题中');
  await requireActiveGroup(workspaceId, groupId);

  const profiles = settings.subAgent?.profiles ?? [];
  if (spec.profile) {
    const named = profiles.find((p) => p.id === spec.profile || p.name === spec.profile);
    if (named?.enabled === false) {
      throw new Error(`子会话 Profile「${named.name}」已停用，请换用其他 Profile 或不指定 profile`);
    }
  }
  const selectedProfile = (spec.profile
    ? profiles.find((p) => p.id === spec.profile || p.name === spec.profile)
    : null)
    ?? profiles.find((p) => p.id === 'default' && p.enabled !== false)
    ?? profiles.find((p) => p.enabled !== false)
    ?? createDefaultSubAgentProfile();

  const modelSel = selectedProfile.modelSelection
    ?? parent.modelSelection
    ?? settings.ai.defaultModelSelection
    ?? null;

  const title = spec.title ?? `子会话: ${spec.task.slice(0, 30)}`;

  if (!parent.sessionId) {
    logger.warn(`发起会话 ${parentConversationId} 尚无 sessionId，新会话 ${title} 将不写入 contractMetadata（无法溯源派出者）`);
  }
  const contractMetadata: conversationService.ContractMetadata | undefined = parent.sessionId
    ? {
        parentSessionId: parent.sessionId,
        task: spec.task,
        expectedOutputPath: spec.outputPath,
        createdBy: 'agent',
        subAgentProfileId: selectedProfile.id,
      }
    : undefined;

  // 先建 conversation 拿到 childId
  const childId = await conversationService.create(workspaceId, groupId, title, modelSel, {
    role: 'sub',
    parentConversationId,
    cachePolicy: '5m',
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

  // 先注册占位 state，保证启动中的子会话可被状态查询和停止逻辑识别。
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

  const session = getPiSessionManager().getSession(attachment.sessionId);
  if (!session) {
    childStates.delete(childId);
    groupSharedService.releaseOutputPath(workspaceId, groupId, spec.outputPath, childId);
    try { conversationRuntimeService.detachAttachment(attachment.attachmentId); } catch { /* ignore */ }
    throw new Error(`session 拉起失败: ${attachment.sessionId}`);
  }

  state.attachmentId = attachment.attachmentId;

  const timeoutMs = (selectedProfile.timeoutMinutes ?? 30) * 60_000;
  state.timeoutTimer = setTimeout(() => { void stopChild(childId, 'timeout'); }, timeoutMs);

  wireSession(childId, session);

  broadcastChildStatusChanged(parentConversationId, childId, 'running', toSnapshot(state));
  broadcastDeliveriesAwaitChanged(parentConversationId);

  // fire-and-forget 发任务
  session.sendMessage(spec.task).catch((error: unknown) => {
    logger.error(`子会话 ${childId} sendMessage 失败`, error);
    onSessionComplete(childId, {
      subtype: 'failed',
      error: { kind: 'runtime', message: extractErrorMessage(error) },
    });
  });

  return toSnapshot(state);
}

export async function stopChild(childId: string, reason: 'cancelled' | 'timeout' = 'cancelled'): Promise<void> {
  const c = childStates.get(childId);
  if (!c || isTerminal(c.status)) return;

  c.status = reason;
  c.finishedAt = Date.now();
  c.errorMessage = reason === 'timeout' ? '超时中断' : '被停止';
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);

  const session = getPiSessionManager().getSession(c.sessionId);
  if (session) {
    try { await session.interrupt(); } catch (err) { logger.warn(`session.interrupt 失败 ${childId}`, err); }
  }
  try { conversationRuntimeService.detachAttachment(c.attachmentId); } catch (err) { logger.warn(`detachAttachment 失败 ${childId}`, err); }
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
 * 在 parentConversationId 派出的子会话中，按子会话自身的 sessionId 反查 childId。
 * 只在「我派出的」范围内查找，防止越权操作别人的子会话。
 */
export function getChildIdBySessionId(parentConversationId: string, sessionId: string): string | null {
  for (const c of childStates.values()) {
    if (c.parentConversationId === parentConversationId && c.sessionId === sessionId) {
      return c.childId;
    }
  }
  return null;
}

/**
 * 子会话反查「派出自己的会话」的 sessionId（子 → 父方向）。
 */
export async function getParentSessionIdByChildConversationId(childConversationId: string): Promise<string | null> {
  const c = childStates.get(childConversationId);
  if (!c) return null;
  const parent = await conversationService.getById(c.workspaceId, c.parentConversationId);
  return parent?.sessionId ?? null;
}

/**
 * 等待某个刚创建的子会话拿到自己的 sessionId。
 * PiSession 改造后 wireSession 的同步兜底必定命中，此函数总是立即 resolve；
 * 保留是为了不改变调用方签名，超时分支已是死代码路径。
 */
export function waitForChildSessionId(childId: string, timeoutMs = 15000): Promise<string | null> {
  const c = childStates.get(childId);
  if (!c) return Promise.resolve(null);
  if (c.sessionId) return Promise.resolve(c.sessionId);

  return new Promise((resolve) => {
    let settled = false;
    const wrapped = (sessionId: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(sessionId);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const list = sessionIdWaiters.get(childId);
      if (list) {
        const idx = list.indexOf(wrapped);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) sessionIdWaiters.delete(childId);
      }
      resolve(null);
    }, timeoutMs);
    const list = sessionIdWaiters.get(childId) ?? [];
    list.push(wrapped);
    sessionIdWaiters.set(childId, list);
  });
}

// ─── 通用消息投递 / 等待（SendMessage / WaitForMessage 的运行时支撑） ───

/**
 * 挂起等待来自指定 sessionId 集合中任意一方的下一条消息。
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

  const localSessionId = getPiSessionManager().getSessionIdByConversation(opts.toConversationId);
  const session = localSessionId ? getPiSessionManager().getSession(localSessionId) : undefined;
  if (!session) return 'target_inactive';

  const senderTag = `<sender kind="agent" session_id="${escapeXmlAttr(opts.fromSessionId)}" name="${escapeXmlAttr(opts.fromLabel)}" delivery="${opts.delivery ? 'true' : 'false'}"/>`;
  const text = `${senderTag}\n${opts.message}`;
  session.sendMessage(text).catch((err: unknown) => {
    logger.warn(`deliverMessage 推送失败 (${opts.toConversationId})`, err);
  });
  return 'queued';
}

/**
 * 只 resolve 属于 parentConversationId 的 WaitForMessage 挂起等待（不碰子会话状态）。
 * 给 interrupt()/close() 在 adapter.abort() 前调用：让卡在 WaitForMessage 工具调用里的
 * prompt() 立即拿到 null 结果返回，Harness 的 waitForIdle() 才不会永久阻塞。
 * 与 abortWaitsForParent 的区别：后者额外 cancel 子会话，供前端"中断等待"按钮使用。
 */
export function abortMessageWaits(parentConversationId: string): number {
  let count = 0;
  for (const [id, w] of messageWaiters) {
    if (w.ownerConversationId !== parentConversationId) continue;
    clearTimeout(w.timer);
    messageWaiters.delete(id);
    w.resolve(null);
    count++;
  }
  return count;
}

/** 中断指定发起会话的所有活跃 WaitForMessage 等待，并终止它名下仍在运行的 Pi 子会话。 */
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

  const childIds = Array.from(childStates.values())
    .filter((c) => c.parentConversationId === parentConversationId && c.status === 'running')
    .map((c) => c.childId);
  for (const childId of childIds) {
    void stopChild(childId, 'cancelled').catch((err) => logger.warn(`中断子会话失败 ${childId}`, err));
  }

  return { abortedWaits, cancelledChildren: childIds.length };
}

/** 转义 XML 属性值中的特殊字符 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
