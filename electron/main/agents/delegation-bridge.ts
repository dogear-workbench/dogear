/**
 * Delegation Bridge — 主进程内 Agent 协作运行时
 * 维护会话创建/停止的状态机（childStates，用于 UI 展示 + no_delivery 检测）+
 * 通用消息投递与等待（messageWaiters，支撑 dogear__SendMessage / dogear__WaitForMessage）+
 * 监听 PiSession 的 complete / error 事件推进状态；
 * 失败终态按错误分类自动复活原会话续跑（transient 重试 / quota 沿全局 failover 链跨供应商降级，
 * 见 settleTerminal → resumeChild），耗尽才通知主会话。
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
import { createDefaultSubAgentProfile, type ModelSelection, type SubAgentProfile } from '../services/settings-types.js';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';
import type {
  ChildStatus,
  ChildStateSnapshot,
  DelegateSpec,
} from '../types.js';
import { createIdleWatch, type IdleWatch } from './delegation-idle.js';
import {
  buildTerminalNotice,
  classifyDelegationError,
  collectTerminalWaiterKeys,
  isNotifiableTerminal,
  terminalStatusLabel,
  type DelegationErrorClass,
  type TerminalInfo,
} from './delegation-terminal.js';
import {
  buildResumePrompt,
  decideResumeOnError,
  type ResumeDecision,
} from './delegation-resume.js';
import { findNextFailover } from './model-failover.js';
import {
  conversationToSnapshot,
  loadRestorableChildren,
  persistDelegationState,
  type PersistedChildState,
} from './delegation-persist.js';

const logger = mainLogger.child('delegation-bridge');

interface ChildStateInternal extends ChildStateSnapshot {
  workspaceId: string;
  attachmentId: string;
  /** 该会话自身的 Harness sessionId；attachConversation 完成后立即同步赋值 */
  sessionId: string;
  timeoutTimer?: NodeJS.Timeout;
  idleWatch?: IdleWatch;
}

export interface WaitForMessageResult {
  fromSessionId: string;
  message: string;
  delivery: boolean;
  /** 子会话失败终态（failed/hang/timeout）的结构化死因；正常消息/交付不带此字段 */
  terminal?: TerminalInfo;
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
const sessionWirings = new Map<string, () => void>();
const settling = new Set<string>();

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
    profileName: c.profileName,
    sessionId: c.sessionId,
    lastActivityAt: c.lastActivityAt,
    retryCount: c.retryCount,
    errorClass: c.errorClass,
    modelTried: c.modelTried,
  };
}

function isTerminal(status: ChildStatus): boolean {
  return status !== 'running';
}

// ─── 持久化（delegation-state.json 落盘 / 重启恢复） ───

function toPersisted(c: ChildStateInternal): PersistedChildState {
  return { ...toSnapshot(c), workspaceId: c.workspaceId };
}

async function persistChildStates(): Promise<void> {
  await persistDelegationState(() => Array.from(childStates.values()).map(toPersisted));
}

/** 状态变更点统一入口：startChild 成功后 / 终态结算后 / markChildDelivered / resumeChild 后。fire-and-forget，失败只记日志 */
function touchPersist(childId: string): void {
  void persistChildStates().catch((err) => logger.warn(`delegation-state.json 落盘失败 (${childId})`, err));
}

/**
 * 应用启动时调用一次：磁盘是重启后的权威来源，先清内存再灌回。
 * running → interrupted（errorMessage '应用重启中断'），attachmentId 清空，
 * conversation 已不存在的条目被 loadRestorableChildren 过滤；恢复后回写使磁盘与内存一致。
 */
export async function loadChildStates(): Promise<void> {
  const { restored, hadEntries } = await loadRestorableChildren();
  childStates.clear();
  for (const p of restored) {
    childStates.set(p.childId, { ...p, sessionId: p.sessionId ?? '', attachmentId: '' });
  }
  if (hadEntries) {
    try {
      await persistChildStates();
    } catch (err) {
      logger.warn('恢复后回写 delegation-state.json 失败', err);
    }
  }
  if (restored.length > 0) {
    logger.info(`delegation 状态恢复：${restored.length} 个子会话条目（running 已标记 interrupted）`);
  }
}

function clearChildTimers(c: ChildStateInternal): void {
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  c.idleWatch?.dispose();
  c.idleWatch = undefined;
}

// ─── session 事件 wiring ───

function wireSession(childId: string, session: PiSession): void {
  const onComplete = (result: PiSessionTurnResult) => onSessionComplete(childId, result);
  // 所有流事件（text/thinking delta、工具起止）都走 'message'，是滑动 idle 计时的打点源
  const onMessage = () => onChildActivity(childId);
  session.on('complete', onComplete);
  session.on('message', onMessage);
  sessionWirings.set(childId, () => {
    session.off('complete', onComplete);
    session.off('message', onMessage);
  });
  // PiSession 在 attachConversation 返回前已 start() 完成，getHarnessSessionId() 此时必定有值，
  // 这是常态路径而非兜底（PiSession 不 emit session_init 事件）
  const existing = session.getHarnessSessionId();
  if (existing) onChildSessionInit(childId, existing);
}

/** 摘除 wireSession 挂的 complete/message 监听，复活重挂前与真正终态时调用，防止监听叠加 */
function unwireSession(childId: string): void {
  const off = sessionWirings.get(childId);
  if (off) {
    off();
    sessionWirings.delete(childId);
  }
}

function onChildSessionInit(childId: string, sessionId: string): void {
  const c = childStates.get(childId);
  if (!c || c.sessionId === sessionId) return;
  // 复活后 harness sessionId 变化时也要更新：waiter 的 fromSdkSessionIds 匹配依赖 c.sessionId 与实际一致
  const hadPrevious = !!c.sessionId;
  c.sessionId = sessionId;
  if (hadPrevious) return;
  const resolvers = sessionIdWaiters.get(childId);
  if (resolvers) {
    sessionIdWaiters.delete(childId);
    for (const resolve of resolvers) resolve(sessionId);
  }
}

function onChildActivity(childId: string): void {
  const c = childStates.get(childId);
  if (!c || c.status !== 'running') return;
  c.lastActivityAt = Date.now();
}

/**
 * 结构化 complete 是本会话这一轮 prompt() 真正跑完的信号，是唯一安全的资源释放时机——
 * markChildDelivered 发生在 dogear__SendMessage 工具调用中途（prompt() 仍在执行），此时 detach 会
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
    c.errorClass = classifyDelegationError(result);
    c.finishedAt = Date.now();
    groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
    broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
    broadcastDeliveriesAwaitChanged(c.parentConversationId);
  }
  clearChildTimers(c);
  void settleTerminal(c);
}

function isRetryableStatus(status: ChildStatus): boolean {
  return status === 'failed' || status === 'hang' || status === 'timeout';
}

async function decideResume(c: ChildStateInternal): Promise<ResumeDecision> {
  if (c.errorClass !== 'quota') {
    return decideResumeOnError(c.errorClass, c.retryCount ?? 0, c.modelTried ?? [], null);
  }
  const conv = await conversationService.getById(c.workspaceId, c.childId);
  const currentProfileId = conv?.modelSelection?.profileId ?? '';
  const settings = await loadSettings();
  if (!settings.failover?.enabled) {
    return decideResumeOnError('quota', c.retryCount ?? 0, c.modelTried ?? [], null);
  }
  const tried = new Set((c.modelTried ?? []).map((key) => key.slice(0, key.indexOf(':'))));
  const entry = findNextFailover(settings.failover.chain, currentProfileId, tried);
  return decideResumeOnError('quota', c.retryCount ?? 0, c.modelTried ?? [], entry);
}

/**
 * 终态统一结算：重调优先于通知——可复活则 resumeChild（状态回 running，不 resolve waiter，
 * 不 detach）；不可复活（耗尽/用户取消/no_delivery）才通知 waiter 并释放 attachment。
 * settling 锁防 interrupt 触发的 complete 事件与 stopChild 主流程双路并发结算。
 */
async function settleTerminal(c: ChildStateInternal): Promise<void> {
  if (settling.has(c.childId)) return;
  settling.add(c.childId);
  try {
    if (isRetryableStatus(c.status) && (c.errorClass === 'transient' || c.errorClass === 'quota')) {
      const decision = await decideResume(c);
      if (decision.resume) {
        const reason = c.status === 'timeout' ? '超时' : c.status === 'hang' ? '长时间无进展' : (c.errorMessage ?? terminalStatusLabel(c.status));
        try {
          await resumeChild(c.childId, { reason, modelOverride: decision.modelOverride ?? null });
          return;
        } catch (err) {
          logger.warn(`子会话 ${c.childId} 自动复活失败，回退终态通知`, err);
        }
      }
    }
    if (isNotifiableTerminal(c.status)) notifyTerminalToWaiters(c);
    unwireSession(c.childId);
    if (c.attachmentId) conversationRuntimeService.detachAttachment(c.attachmentId);
    touchPersist(c.childId);
  } finally {
    settling.delete(c.childId);
  }
}

/**
 * 复活原会话续跑（不新建副本）：降级时先换 conversation.modelSelection 再 attach
 * （attach 复用存活 session，不重读模型，所以降级前必须先 detach 让旧 session 销毁重建）；
 * 同模型重试则直接复用存活 session 保留内存上下文。所有 await 步骤成功后才提交状态，
 * 失败时状态仍是终态，由调用方回退通知。dogear__ResumeSession 工具与终态自动重调都走这里。
 */
export async function resumeChild(childId: string, opts: { reason: string; modelOverride?: ModelSelection | null }): Promise<void> {
  const c = childStates.get(childId);
  if (!c || c.status === 'running') return;

  if (opts.modelOverride) {
    await conversationService.updateModelSelection(c.workspaceId, childId, opts.modelOverride);
    if (c.attachmentId) {
      try { conversationRuntimeService.detachAttachment(c.attachmentId); } catch { /* ignore */ }
      c.attachmentId = '';
      unwireSession(childId);
    }
  }

  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  const claim = await groupSharedService.claimOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  // file_exists 视为本会话部分产出继续复用（复活前刚 release，其他会话拿不到 claim）；
  // 真正占用冲突只有 claimed_by_other
  if (!claim.ok && claim.reason === 'claimed_by_other') {
    throw new Error(`outputPath "${c.outputPath}" 已被子会话 ${claim.holderChildId} 占用，无法复活`);
  }

  const oldAttachmentId = c.attachmentId;
  const attachment = await conversationRuntimeService.attachConversation(childId, c.workspaceId, 'desktop', {});
  const session = getPiSessionManager().getSession(attachment.sessionId);
  if (!session) {
    if (oldAttachmentId && oldAttachmentId !== attachment.attachmentId) {
      try { conversationRuntimeService.detachAttachment(attachment.attachmentId); } catch { /* ignore */ }
    }
    throw new Error(`复活拉起 session 失败: ${attachment.sessionId}`);
  }

  const conv = await conversationService.getById(c.workspaceId, childId);
  const modelSel = opts.modelOverride ?? conv?.modelSelection ?? null;
  const settings = await loadSettings();
  // modelSelection.profileId 指向 ModelProfile（供应商），不是 SubAgentProfile.id
  const profile = modelSel
    ? (settings.subAgent?.profiles ?? []).find((p) => p.modelSelection?.profileId === modelSel.profileId)
    : undefined;

  c.attachmentId = attachment.attachmentId;
  if (oldAttachmentId && oldAttachmentId !== attachment.attachmentId) {
    try { conversationRuntimeService.detachAttachment(oldAttachmentId); } catch { /* ignore */ }
  }

  const now = Date.now();
  c.status = 'running';
  c.errorMessage = undefined;
  c.finishedAt = undefined;
  c.lastActivityAt = now;
  c.retryCount = (c.retryCount ?? 0) + 1;
  if (modelSel) {
    const tried = c.modelTried ?? [];
    const key = `${modelSel.profileId}:${modelSel.tier}`;
    if (!tried.includes(key)) tried.push(key);
    c.modelTried = tried;
  }
  if (opts.modelOverride && profile) c.profileName = profile.name;

  unwireSession(childId);
  c.timeoutTimer = setTimeout(() => { void stopChild(childId, 'timeout'); }, (profile?.timeoutMinutes ?? 30) * 60_000);
  c.idleWatch = createIdleWatch({
    session,
    onActivity: () => onChildActivity(childId),
    onIdle: () => { void stopChild(childId, 'hang'); },
  });
  wireSession(childId, session);

  broadcastChildStatusChanged(c.parentConversationId, childId, 'running', toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
  touchPersist(childId);

  logger.info(`子会话 ${childId} 第 ${c.retryCount} 次自动复活（${opts.modelOverride ? `降级至 ${opts.modelOverride.profileId}:${opts.modelOverride.tier}` : '原模型'}）：${opts.reason}`);
  session.sendMessage(buildResumePrompt(opts.reason, c.outputPath)).catch((error: unknown) => {
    logger.error(`子会话 ${childId} 复活后 sendMessage 失败`, error);
    onSessionComplete(childId, {
      subtype: 'failed',
      error: { kind: 'runtime', message: extractErrorMessage(error) },
    });
  });
}

/**
 * 终态联动：把终态秒级透给挂起在 dogear__WaitForMessage 的父会话，
 * 替代旧「干等满超时只拿到 null」。幂等：waiter resolve 即删，多条终态路径重复调用是 no-op。
 * 只在 settleTerminal 的「不重调」分支被调，errorClass/attempts/modelTried 填实际值。
 */
function notifyTerminalToWaiters(c: ChildStateInternal): void {
  if (!c.sessionId) return;
  const keys = collectTerminalWaiterKeys(messageWaiters, c.parentConversationId, c.sessionId);
  for (const key of keys) {
    const w = messageWaiters.get(key);
    if (!w) continue;
    clearTimeout(w.timer);
    messageWaiters.delete(key);
    w.resolve({
      fromSessionId: c.sessionId,
      message: buildTerminalNotice(c, c.retryCount ?? 0),
      delivery: false,
      terminal: {
        status: c.status,
        errorMessage: c.errorMessage,
        errorClass: c.errorClass ?? 'transient',
        attempts: c.retryCount ?? 0,
        modelTried: c.modelTried ?? [],
      },
    });
  }
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
    profileName: selectedProfile.name,
    attachmentId: '',
    sessionId: '',
    lastActivityAt: now,
    retryCount: 0,
    modelTried: modelSel ? [`${modelSel.profileId}:${modelSel.tier}`] : [],
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

  state.idleWatch = createIdleWatch({
    session,
    onActivity: () => onChildActivity(childId),
    onIdle: () => { void stopChild(childId, 'hang'); },
  });

  wireSession(childId, session);

  broadcastChildStatusChanged(parentConversationId, childId, 'running', toSnapshot(state));
  broadcastDeliveriesAwaitChanged(parentConversationId);
  touchPersist(childId);

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

/**
 * 置入终态并结算：cancelled（用户主动停）不重调；hang/timeout 按 transient 处理（可复活）。
 * 结算统一走 settleTerminal（重调优先于通知）。
 */
export async function stopChild(childId: string, reason: 'cancelled' | 'timeout' | 'hang' = 'cancelled'): Promise<void> {
  const c = childStates.get(childId);
  if (!c || isTerminal(c.status)) return;

  c.status = reason;
  c.finishedAt = Date.now();
  c.errorMessage = reason === 'timeout' ? '超时中断' : reason === 'hang' ? '无进展中断' : '被停止';
  c.errorClass = reason === 'cancelled' ? 'cancelled' : 'transient';
  clearChildTimers(c);
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);

  const session = getPiSessionManager().getSession(c.sessionId);
  if (session) {
    try { await session.interrupt(); } catch (err) { logger.warn(`session.interrupt 失败 ${childId}`, err); }
  }
  await settleTerminal(c);
}

/**
 * 标记某个会话已通过 dogear__SendMessage(delivery:true) 完成交付（由 delegation-tools 调用）。
 * 只对仍处于 running 状态的会话生效，幂等安全。
 */
export function markChildDelivered(childId: string, summary: string): void {
  const c = childStates.get(childId);
  if (!c || c.status !== 'running') return;
  c.status = 'done';
  c.summary = summary;
  c.finishedAt = Date.now();
  clearChildTimers(c);
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, 'done', toSnapshot(c));
  broadcastDeliveriesAwaitChanged(c.parentConversationId);
  touchPersist(childId);
}

/**
 * 内存 childStates 为主，conversation-service 持久层补集合并：
 * 重启后内存丢失的历史子会话仍能被 ListLinkedSessions / 前端列表看到。
 * 去重键 childId，内存优先；持久层条目 task/outputPath 从 contractMetadata 补、
 * profileName 从 subAgentProfileId 反查 settings，status 恒为 interrupted。
 */
export async function getChildrenByParent(parentConversationId: string): Promise<ChildStateSnapshot[]> {
  const memoryChildren: ChildStateSnapshot[] = [];
  let workspaceId: string | null = null;
  for (const c of childStates.values()) {
    if (c.parentConversationId !== parentConversationId) continue;
    memoryChildren.push(toSnapshot(c));
    workspaceId ??= c.workspaceId;
  }

  if (!workspaceId) {
    const parent = await conversationService.getByIdGlobal(parentConversationId);
    if (!parent) return memoryChildren;
    workspaceId = parent.workspaceId;
  }

  const persisted = await conversationService.listByParent(workspaceId, parentConversationId);
  const known = new Set(memoryChildren.map((c) => c.childId));
  const extra = persisted.filter((conv) => !known.has(conv.id));
  if (extra.length === 0) return memoryChildren;

  const settings = await loadSettings();
  const profiles: SubAgentProfile[] = settings.subAgent?.profiles ?? [];
  return [...memoryChildren, ...extra.map((conv) => conversationToSnapshot(conv, profiles))];
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

// ─── 通用消息投递 / 等待（dogear__SendMessage / dogear__WaitForMessage 的运行时支撑） ───

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
 * 'waiter'：目标正在 dogear__WaitForMessage 挂起，消息直接送进它的等待结果
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
 * 只 resolve 属于 parentConversationId 的 dogear__WaitForMessage 挂起等待（不碰子会话状态）。
 * 给 interrupt()/close() 在 adapter.abort() 前调用：让卡在 dogear__WaitForMessage 工具调用里的
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

/** 中断指定发起会话的所有活跃 dogear__WaitForMessage 等待，并终止它名下仍在运行的 Pi 子会话。 */
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
