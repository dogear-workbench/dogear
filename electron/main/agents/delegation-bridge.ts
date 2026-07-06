/**
 * Delegation Bridge — 主进程内子会话派遣运行时
 * 维护活跃子会话状态机 + Promise 挂起池 + 监听 QueryBasedSession complete/error 推进 status
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
  DeliveryResult,
} from '../types.js';

const logger = mainLogger.child('delegation-bridge');

interface ChildStateInternal extends ChildStateSnapshot {
  workspaceId: string;
  attachmentId: string;
  sessionId: string;
  timeoutTimer?: NodeJS.Timeout;
}

interface WaitStateInternal {
  id: string;
  parentConversationId: string;
  childIds: string[];
  resolve: (results: DeliveryResult[]) => void;
  timer: NodeJS.Timeout;
}

interface AskPendingInternal {
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  question: string;
  askedAt: number;
}

const childStates = new Map<string, ChildStateInternal>();
const waitStates = new Map<string, WaitStateInternal>();
const askPending = new Map<string, AskPendingInternal>();

function clearAskPendingForChild(childId: string, reason: string): void {
  const pending = askPending.get(childId);
  if (!pending) return;
  askPending.delete(childId);
  pending.reject(new Error(reason));
}

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
  };
}

function buildResults(childIds: string[]): DeliveryResult[] {
  return childIds.map(id => {
    const c = childStates.get(id);
    if (!c) {
      return {
        childId: id,
        status: 'failed' as ChildStatus,
        outputPath: '',
        task: '',
        title: '',
        errorMessage: '子会话状态丢失',
        startedAt: 0,
      };
    }
    return {
      childId: c.childId,
      status: c.status,
      outputPath: c.outputPath,
      title: c.title,
      summary: c.summary,
      errorMessage: c.errorMessage,
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
    };
  });
}

function isTerminal(status: ChildStatus): boolean {
  return status !== 'running';
}

function resolveWaitsIfReady(): void {
  for (const [waitId, ws] of waitStates) {
    const allTerminal = ws.childIds.every(id => {
      const c = childStates.get(id);
      return c ? isTerminal(c.status) : true;
    });
    if (allTerminal) {
      clearTimeout(ws.timer);
      waitStates.delete(waitId);
      ws.resolve(buildResults(ws.childIds));
    }
  }
}

// ─── session 事件 wiring ───

function wireSession(childId: string, session: QueryBasedSession): void {
  session.on('complete', () => onSessionComplete(childId));
  session.on('error', (msg: unknown) => onSessionError(childId, msg));
}

function onSessionComplete(childId: string): void {
  const c = childStates.get(childId);
  if (!c || c.status !== 'running') return;
  // 子 agent 自然停了但没调 SubmitDelivery
  c.status = 'no_delivery';
  c.finishedAt = Date.now();
  c.errorMessage = '子会话结束但未提交交付物';
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  clearAskPendingForChild(childId, '子会话结束前未收到 ReplyToChild');
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
  resolveWaitsIfReady();
}

function onSessionError(childId: string, msg: unknown): void {
  const c = childStates.get(childId);
  if (!c || c.status !== 'running') return;
  c.status = 'failed';
  c.finishedAt = Date.now();
  c.errorMessage = extractErrorMessage(msg);
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  clearAskPendingForChild(childId, '子会话异常前未收到 ReplyToChild');
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
  resolveWaitsIfReady();
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

// ─── 对外方法 ───

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
  if (!parent) throw new Error(`父对话 ${parentConversationId} 不存在`);

  const modelSel = settings.subAgent?.modelSelection
    ?? parent.modelSelection
    ?? settings.ai.defaultModelSelection
    ?? null;

  const title = spec.title ?? `子会话: ${spec.task.slice(0, 30)}`;

  // 先建 conversation 拿到 childId
  const childId = await conversationService.create(workspaceId, groupId, title, modelSel, {
    role: 'sub',
    parentConversationId,
    cachePolicy: parent.cachePolicy,
  });

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

export async function submitDelivery(childId: string, summary: string, outputPath: string): Promise<void> {
  const c = childStates.get(childId);
  if (!c) throw new Error(`子会话 ${childId} 不存在`);
  if (c.status !== 'running') throw new Error(`子会话 ${childId} 不在运行状态（当前 ${c.status}）`);
  if (outputPath !== c.outputPath) throw new Error(`outputPath 不匹配：期望 "${c.outputPath}"，实际 "${outputPath}"`);

  let content: string;
  try {
    content = await groupSharedService.readNativeFile(c.workspaceId, c.groupId, outputPath);
  } catch (err) {
    throw new Error(`交付物文件未写入或读取失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!content.trim()) throw new Error('交付物文件为空');

  c.status = 'done';
  c.summary = summary;
  c.finishedAt = Date.now();
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, outputPath, childId);

  broadcastChildStatusChanged(c.parentConversationId, childId, 'done', toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
  resolveWaitsIfReady();
}

export async function waitFor(
  parentConversationId: string,
  childIds: string[],
  timeoutMs?: number,
): Promise<DeliveryResult[]> {
  for (const id of childIds) {
    const c = childStates.get(id);
    if (!c) throw new Error(`子会话 ${id} 不存在`);
    if (c.parentConversationId !== parentConversationId) {
      throw new Error(`子会话 ${id} 不属于父会话 ${parentConversationId}`);
    }
  }

  const allTerminal = childIds.every(id => isTerminal(childStates.get(id)!.status));
  if (allTerminal) return buildResults(childIds);

  const settings = await loadSettings();
  const effectiveTimeoutMs = timeoutMs ?? (settings.subAgent?.timeoutMinutes ?? 30) * 60_000;

  return new Promise<DeliveryResult[]>(resolve => {
    const waitId = uuidv4();
    const timer = setTimeout(() => {
      waitStates.delete(waitId);
      // 把还在 running 的强制 timeout
      const pending = childIds.filter(id => {
        const c = childStates.get(id);
        return c && c.status === 'running';
      });
      void Promise.all(pending.map(id => stopChild(id, 'timeout'))).then(() => {
        resolve(buildResults(childIds));
      });
    }, effectiveTimeoutMs);

    waitStates.set(waitId, { id: waitId, parentConversationId, childIds: [...childIds], resolve, timer });
  });
}

export async function stopChild(childId: string, reason: 'cancelled' | 'timeout' = 'cancelled'): Promise<void> {
  const c = childStates.get(childId);
  if (!c) return;
  if (isTerminal(c.status)) return;

  c.status = reason;
  c.finishedAt = Date.now();
  c.errorMessage = reason === 'timeout' ? '超时中断' : '被父会话停止';
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  clearAskPendingForChild(childId, reason === 'timeout' ? '子会话超时中断' : '子会话被停止');

  const session = getQueryBasedSessionManager().getSession(c.sessionId);
  if (session) {
    try { await session.interrupt(); } catch (err) { logger.warn(`session.interrupt 失败 ${childId}`, err); }
  }
  try { conversationRuntimeService.detachAttachment(c.attachmentId); } catch (err) { logger.warn(`detachAttachment 失败 ${childId}`, err); }

  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);

  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
  resolveWaitsIfReady();
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

export async function sendMessageToChild(childId: string, message: string): Promise<void> {
  const c = childStates.get(childId);
  if (!c) throw new Error(`子会话 ${childId} 不存在`);
  if (c.status !== 'running') throw new Error(`子会话 ${childId} 不在运行状态（当前 ${c.status}）`);

  const session = getQueryBasedSessionManager().getSession(c.sessionId);
  if (!session) throw new Error(`子会话 ${childId} session 已丢失`);

  await session.sendMessage(message);
}

export async function previewClaim(
  workspaceId: string,
  groupId: string,
  relPaths: string[],
): Promise<{ ok: true } | { ok: false; conflicts: groupSharedService.PreviewClaimConflict[] }> {
  return groupSharedService.previewClaim(workspaceId, groupId, relPaths);
}

export async function askParent(childId: string, question: string): Promise<string> {
  const c = childStates.get(childId);
  if (!c) throw new Error(`子会话 ${childId} 不存在`);
  if (c.status !== 'running') throw new Error(`子会话 ${childId} 不在运行状态（当前 ${c.status}）`);
  if (askPending.has(childId)) {
    throw new Error('已有一个未回复的 AskParent，请等待主会话回复后再问下一个');
  }

  const parentSessionId = getQueryBasedSessionManager().getSessionIdByConversation(c.parentConversationId);
  if (!parentSessionId) {
    throw new Error(`父会话 ${c.parentConversationId} 当前未激活，无法反问`);
  }
  const parentSession = getQueryBasedSessionManager().getSession(parentSessionId);
  if (!parentSession) {
    throw new Error(`父会话 session ${parentSessionId} 已丢失`);
  }

  const pushedText = [
    `[子会话 反问 · ${c.title}（${childId}）]`,
    question,
    '',
    `（请用 ReplyToChild({ childId: "${childId}", answer: "..." }) 回复，否则该子会话会一直挂着）`,
  ].join('\n');

  return new Promise<string>((resolve, reject) => {
    askPending.set(childId, { resolve, reject, question, askedAt: Date.now() });
    parentSession.sendMessage(pushedText).catch((err: unknown) => {
      const pending = askPending.get(childId);
      if (pending) {
        askPending.delete(childId);
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export function replyToChild(childId: string, answer: string): void {
  const pending = askPending.get(childId);
  if (!pending) throw new Error(`子会话 ${childId} 当前没有挂起的 AskParent`);
  askPending.delete(childId);
  pending.resolve(answer);
}

/**
 * 中断指定父会话所有活跃的 WaitForDeliveries。
 * 行为：把每个 waitState 中仍在 running 的 child mark 'cancelled' + 释放 outputPath，
 * 但**不**调用 session.interrupt（子会话继续跑或自行完成；之后调 SubmitDelivery 会拿到 isError）。
 * 最后 resolve 所有 waitState Promise，让主会话 query 解锁。
 */
export function abortWaitsForParent(parentConversationId: string): {
  abortedWaits: number;
  cancelledChildren: number;
} {
  const relevantWaits: WaitStateInternal[] = [];
  for (const ws of waitStates.values()) {
    if (ws.parentConversationId === parentConversationId) relevantWaits.push(ws);
  }
  if (relevantWaits.length === 0) return { abortedWaits: 0, cancelledChildren: 0 };

  const cancelledChildIds = new Set<string>();
  for (const ws of relevantWaits) {
    for (const childId of ws.childIds) {
      const c = childStates.get(childId);
      if (!c || c.status !== 'running') continue;
      c.status = 'cancelled';
      c.finishedAt = Date.now();
      c.errorMessage = '父会话中断了等待';
      if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
      clearAskPendingForChild(childId, '父会话中断等待');
      groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
      broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
      cancelledChildIds.add(childId);
    }
  }
  if (cancelledChildIds.size > 0) {
    broadcastDeliveriesAwaitChanged(parentConversationId);
  }

  for (const ws of relevantWaits) {
    clearTimeout(ws.timer);
    waitStates.delete(ws.id);
    ws.resolve(buildResults(ws.childIds));
  }

  return { abortedWaits: relevantWaits.length, cancelledChildren: cancelledChildIds.size };
}
