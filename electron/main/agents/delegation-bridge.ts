/**
 * Delegation Bridge — 主进程内 Agent 协作运行时
 * 维护会话创建/停止的状态机（childStates，用于 UI 展示 + no_delivery 检测）+
 * 通用消息投递（支撑 dogear__SendMessage，交付/终态统一注入目标会话）+
 * 监听 PiSession 的 complete / error 事件推进状态；
 * 失败终态按错误分类自动复活原会话续跑（transient 重试 / quota 沿全局 failover 链跨供应商降级，
 * 见 settleTerminal → resumeChild），耗尽才通知主会话。
 */

import { BrowserWindow } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';

import type { PiSession, PiSessionTurnResult } from './pi-session/pi-session.js';
import type { InjectionTag } from './task-types.js';
import { classifyChildCompletion } from './delegation-lifecycle.js';
import { getPiSessionManager } from './pi-session/pi-session-manager.js';
import { mainLogger } from './logger.js';
import * as conversationService from '../services/conversation-service.js';
import type { ConversationIndex } from '../services/conversation-service.js';
import { broadcastConversationListChanged } from '../services/renderer-broadcast.js';
import { requireActiveGroup } from '../services/group-service.js';
import * as groupSharedService from '../services/group-shared-service.js';
import { loadSettings } from '../services/settings-service.js';
import { createDefaultSubAgentProfile, isProfileComplete, type AppSettings, type ModelSelection, type SubAgentProfile } from '../services/settings-types.js';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';
import type {
  ChildStatus,
  ChildStateSnapshot,
  ChildTerminalReason,
  DelegateSpec,
} from '../types.js';
import { createIdleWatch, type IdleWatch } from './delegation-idle.js';
import {
  buildTerminalNotice,
  classifyDelegationError,
  isNotifiableTerminal,
  terminalStatusLabel,
  type DelegationErrorClass,
} from './delegation-terminal.js';
import {
  buildResumePrompt,
  decideResumeOnError,
  type ResumeDecision,
} from './delegation-resume.js';
import { findNextFailover } from './model-failover.js';

const logger = mainLogger.child('delegation-bridge');

interface ChildStateInternal extends ChildStateSnapshot {
  workspaceId: string;
  attachmentId: string;
  /** 该会话自身的 Harness sessionId；attachConversation 完成后立即同步赋值 */
  sessionId: string;
  /** stopped 时的死因，仅供调度内部重试决策与通知判定，不进快照 */
  terminalReason?: ChildTerminalReason;
  /** 错误分类（transient/quota/cancelled），驱动重调决策 */
  errorClass?: DelegationErrorClass;
  /** 已试过的模型链（quota 降级防重），profileId:tier 列表 */
  modelTried?: string[];
  /** 连续失败次数：complete 正常到达（subtype=success）时清零 */
  consecutiveFails: number;
  /** spawnChild 时 acquire 保活的父会话 sessionId，终态结算时 release；未成功 acquire 则无值 */
  parentHoldSessionId?: string;
  timeoutTimer?: NodeJS.Timeout;
  idleWatch?: IdleWatch;
}

const childStates = new Map<string, ChildStateInternal>();
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

function toSnapshot(c: ChildStateInternal): ChildStateSnapshot {
  return {
    childId: c.childId,
    parentConversationId: c.parentConversationId,
    groupId: c.groupId,
    outputPath: c.outputPath,
    task: c.task,
    title: c.title,
    status: c.status,
    delivered: c.delivered,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    lastError: c.lastError,
    profileName: c.profileName,
    sessionId: c.sessionId,
    lastActivityAt: c.lastActivityAt,
  };
}

function isTerminal(status: ChildStatus): boolean {
  return status !== 'running';
}

function clearChildTimers(c: ChildStateInternal): void {
  if (c.timeoutTimer) { clearTimeout(c.timeoutTimer); c.timeoutTimer = undefined; }
  c.idleWatch?.dispose();
  c.idleWatch = undefined;
}

// 父会话非 UI 保活：有 running 直属子会话期间父会话不因引用归零被销毁。
// 粒度与 childStates 同生命周期（内存态）；父会话已不在内存时 acquire 失败即为无保活，
// release 时对旧 sessionId 的释放是 no-op，不会泄漏
function acquireParentHold(c: ChildStateInternal): void {
  const manager = getPiSessionManager();
  const parentSessionId = manager.getSessionIdByConversation(c.parentConversationId);
  if (parentSessionId && manager.acquireHold(parentSessionId)) {
    c.parentHoldSessionId = parentSessionId;
  }
}

function releaseParentHold(c: ChildStateInternal): void {
  if (!c.parentHoldSessionId) return;
  const holdId = c.parentHoldSessionId;
  c.parentHoldSessionId = undefined;
  getPiSessionManager().releaseHold(holdId).catch((err) => {
    logger.warn(`释放父会话保活失败 ${holdId}`, err);
  });
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
  // 复活后 harness sessionId 变化时也要更新：终态通知的 sender 标签与契约反查依赖 c.sessionId 与实际一致
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
    if (result.subtype === 'success') c.consecutiveFails = 0;
    const completion = classifyChildCompletion(result, c.delivered);
    c.status = 'stopped';
    c.terminalReason = completion.terminalReason;
    c.lastError = completion.lastError;
    c.errorClass = classifyDelegationError(result);
    c.finishedAt = Date.now();
    groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
    broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
  }
  clearChildTimers(c);
  void settleTerminal(c);
}

function isRetryableTerminal(reason: ChildTerminalReason | undefined): boolean {
  return reason === 'failed' || reason === 'hang' || reason === 'timeout';
}

async function decideResume(c: ChildStateInternal): Promise<ResumeDecision> {
  if (c.errorClass !== 'quota') {
    return decideResumeOnError(c.errorClass, c.consecutiveFails, c.modelTried ?? [], null);
  }
  const conv = await conversationService.getById(c.workspaceId, c.childId);
  const currentProfileId = conv?.modelSelection?.profileId ?? '';
  const settings = await loadSettings();
  if (!settings.failover?.enabled) {
    return decideResumeOnError('quota', c.consecutiveFails, c.modelTried ?? [], null);
  }
  const tried = new Set((c.modelTried ?? []).map((key) => key.slice(0, key.indexOf(':'))));
  const entry = findNextFailover(settings.failover.chain, currentProfileId, tried);
  return decideResumeOnError('quota', c.consecutiveFails, c.modelTried ?? [], entry);
}

/**
 * 终态统一结算：重调优先于通知——可复活则 resumeChild（状态回 running，不 detach）；
 * 不可复活（耗尽/用户取消/no_delivery）才向父会话注入终态通知并释放 attachment。
 * settling 锁防 interrupt 触发的 complete 事件与 stopChild 主流程双路并发结算。
 */
async function settleTerminal(c: ChildStateInternal): Promise<void> {
  if (settling.has(c.childId)) return;
  settling.add(c.childId);
  try {
    if (isRetryableTerminal(c.terminalReason) && (c.errorClass === 'transient' || c.errorClass === 'quota')) {
      const decision = await decideResume(c);
      if (decision.resume) {
        const reason = c.terminalReason === 'timeout' ? '超时' : c.terminalReason === 'hang' ? '长时间无进展' : (c.lastError ?? terminalStatusLabel(c.terminalReason));
        try {
          await resumeChild(c.childId, { reason, modelOverride: decision.modelOverride ?? null });
          return;
        } catch (err) {
          logger.warn(`子会话 ${c.childId} 自动复活失败，回退终态通知`, err);
        }
      }
    }
    if (isNotifiableTerminal(c.terminalReason)) await notifyTerminalToParent(c);
    unwireSession(c.childId);
    if (c.attachmentId) conversationRuntimeService.detachAttachment(c.attachmentId);
    releaseParentHold(c);
    // complete 已结算仍 isRunning() = run 卡死未 settle 的僵尸，遗弃强杀而非等待（close 内部 abort 有界兜底）
    if (getPiSessionManager().getSession(c.sessionId)?.isRunning()) {
      void getPiSessionManager().closeSession(c.sessionId);
    }
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
export async function resumeChild(childId: string, opts: { reason: string; modelOverride?: ModelSelection | null; wakeupMessage?: string; wakeupTag?: InjectionTag }): Promise<void> {
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

  // 通讯型交付无路径占用，跳过 release/re-claim 对（避免对空串的 file_exists 误判）
  if (c.outputPath) {
    groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
    const claim = await groupSharedService.claimOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
    // file_exists 视为本会话部分产出继续复用（复活前刚 release，其他会话拿不到 claim）；
    // 真正占用冲突只有 claimed_by_other
    if (!claim.ok && claim.reason === 'claimed_by_other') {
      throw new Error(`outputPath "${c.outputPath}" 已被子会话 ${claim.holderChildId} 占用，无法复活`);
    }
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
  c.terminalReason = undefined;
  c.lastError = undefined;
  c.finishedAt = undefined;
  c.lastActivityAt = now;
  c.consecutiveFails += 1;
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

  logger.info(`子会话 ${childId} 第 ${c.consecutiveFails} 次自动复活（${opts.modelOverride ? `降级至 ${opts.modelOverride.profileId}:${opts.modelOverride.tier}` : '原模型'}）：${opts.reason}`);
  const wakeInput = opts.wakeupMessage ?? buildResumePrompt(opts.reason, c.outputPath);
  const wakeTag: InjectionTag = opts.wakeupMessage ? (opts.wakeupTag ?? deliveryToTag(false)) : 'resume';
  session.sendMessage(wakeInput, { injectionTag: wakeTag }).catch((error: unknown) => {
    logger.error(`子会话 ${childId} 复活后 sendMessage 失败`, error);
    onSessionComplete(childId, {
      subtype: 'failed',
      error: { kind: 'runtime', message: extractErrorMessage(error) },
    });
  });
}

/**
 * 终态联动：把终态通知注入父会话（running 时 steer 排队、idle 时 prompt 立即生效）；
 * 父会话不在内存时自动调起再注入——失败型终态是唯一告警信号，不可静默丢弃。
 * 幂等：多条终态路径重复调用由 settling 锁挡住。
 * 只在 settleTerminal 的「不重调」分支被调，errorClass/attempts/modelTried 填实际值。
 */
async function notifyTerminalToParent(c: ChildStateInternal): Promise<void> {
  if (!c.sessionId) return;
  const notice = buildTerminalNotice({
    title: c.title,
    terminalReason: c.terminalReason,
    lastError: c.lastError,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    errorClass: c.errorClass,
    modelTried: c.modelTried,
  }, c.consecutiveFails);

  const msg = {
    fromSessionId: c.sessionId,
    fromLabel: c.title,
    message: notice,
    delivery: false,
    tag: 'terminal' as const,
  };
  if (pushToParentSession(c.parentConversationId, msg)) return;
  logger.warn(`父会话 ${c.parentConversationId} 未在运行，自动调起后注入终态通知（子会话 ${c.childId} ${terminalStatusLabel(c.terminalReason)}）`);
  try {
    await resumeParentAndDeliver(c.parentConversationId, c.workspaceId, msg);
  } catch (err) {
    logger.warn(`终态通知自动调起父会话失败（${c.parentConversationId}），通知丢弃`, err);
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '未知错误';
}

/**
 * 按模型 ID（tier）在所有完整 ModelProfile 的 piModels 里解析出 profileId+tier；
 * 同一模型存在于多个 profile 时取第一个匹配；解析不到时抛错并列出可用模型，供 agent 自纠。
 */
function resolveModelByTier(settings: AppSettings, tier: string): ModelSelection {
  const available = new Set<string>();
  for (const [profileId, profile] of Object.entries(settings.profiles ?? {})) {
    if (!isProfileComplete(profile)) continue;
    for (const m of profile.piModels ?? []) {
      if (m.id === tier) return { profileId, tier: m.id };
    }
    for (const m of profile.piModels ?? []) available.add(m.id);
  }
  const list = [...available].join('、') || '（无）';
  throw new Error(`模型 "${tier}" 不存在。可用模型：${list}`);
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

  const modelSel = (spec.model ? resolveModelByTier(settings, spec.model) : null)
    ?? selectedProfile.modelSelection
    ?? parent.modelSelection
    ?? settings.ai.defaultModelSelection
    ?? null;

  const title = spec.title ?? `子会话: ${spec.task.slice(0, 30)}`;
  // 空 outputPath = 通讯型交付：不进占用表（claim 对空串会误判 file_exists）
  const outputPath = spec.outputPath ?? '';

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
    contractMetadata,
  });
  broadcastConversationListChanged(workspaceId);

  // claim outputPath，失败则回滚；通讯型交付无路径可占，跳过
  if (outputPath) {
    const claim = await groupSharedService.claimOutputPath(workspaceId, groupId, outputPath, childId);
    if (!claim.ok) {
      try { await conversationService.deleteConversation(workspaceId, childId); } catch (err) { logger.warn('回滚 conversation 失败', err); }
      if (claim.reason === 'file_exists') {
        throw new Error(`outputPath "${outputPath}" 对应文件已存在`);
      }
      throw new Error(`outputPath "${outputPath}" 已被子会话 ${claim.holderChildId} 占用`);
    }
  }

  // 先注册占位 state，保证启动中的子会话可被状态查询和停止逻辑识别。
  const now = Date.now();
  const state: ChildStateInternal = {
    childId,
    parentConversationId,
    groupId,
    outputPath,
    task: spec.task,
    title,
    status: 'running',
    delivered: false,
    startedAt: now,
    workspaceId,
    profileName: selectedProfile.name,
    attachmentId: '',
    sessionId: '',
    lastActivityAt: now,
    consecutiveFails: 0,
    modelTried: modelSel ? [`${modelSel.profileId}:${modelSel.tier}`] : [],
  };
  childStates.set(childId, state);

  // attach 拉起 session
  let attachment: Awaited<ReturnType<typeof conversationRuntimeService.attachConversation>>;
  try {
    attachment = await conversationRuntimeService.attachConversation(childId, workspaceId, 'desktop', {});
  } catch (err) {
    childStates.delete(childId);
    groupSharedService.releaseOutputPath(workspaceId, groupId, outputPath, childId);
    try { await conversationService.deleteConversation(workspaceId, childId); } catch { /* ignore */ }
    throw err;
  }

  const session = getPiSessionManager().getSession(attachment.sessionId);
  if (!session) {
    childStates.delete(childId);
    groupSharedService.releaseOutputPath(workspaceId, groupId, outputPath, childId);
    try { conversationRuntimeService.detachAttachment(attachment.attachmentId); } catch { /* ignore */ }
    throw new Error(`session 拉起失败: ${attachment.sessionId}`);
  }

  state.attachmentId = attachment.attachmentId;
  acquireParentHold(state);

  const timeoutMs = (selectedProfile.timeoutMinutes ?? 30) * 60_000;
  state.timeoutTimer = setTimeout(() => { void stopChild(childId, 'timeout'); }, timeoutMs);

  state.idleWatch = createIdleWatch({
    session,
    onActivity: () => onChildActivity(childId),
    onIdle: () => { void stopChild(childId, 'hang'); },
  });

  wireSession(childId, session);

  broadcastChildStatusChanged(parentConversationId, childId, 'running', toSnapshot(state));

  // fire-and-forget 发任务：sender 标签 + dispatch 注入标记，子会话侧首条 task 以「派出」注入卡呈现而非用户气泡
  session.sendMessage(`${buildSenderTag(parent.sessionId ?? '', parent.title, false, 'dispatch')}\n${spec.task}`, { injectionTag: 'dispatch' }).catch((error: unknown) => {
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

  c.status = 'stopped';
  c.terminalReason = reason;
  c.finishedAt = Date.now();
  c.lastError = reason === 'timeout' ? '超时中断' : reason === 'hang' ? '无进展中断' : '被停止';
  c.errorClass = reason === 'cancelled' ? 'cancelled' : 'transient';
  clearChildTimers(c);
  groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));

  const session = getPiSessionManager().getSession(c.sessionId);
  if (session) {
    try { await session.interrupt(); } catch (err) { logger.warn(`session.interrupt 失败 ${childId}`, err); }
  }
  await settleTerminal(c);
}

/**
 * 标记某个会话已通过 dogear__SendMessage(delivery:true) 完成交付（由 delegation-tools 调用）。
 * 交付是独立单调事实：guard 只挡重复标记，不挡状态——no_delivery 终态后补交付也能落上；
 * 不改 status/timers/finishedAt，complete 事件才是安全的资源收尾点。
 */
export function markChildDelivered(childId: string): void {
  const c = childStates.get(childId);
  if (!c || c.delivered) return;
  c.delivered = true;
  if (c.outputPath) groupSharedService.releaseOutputPath(c.workspaceId, c.groupId, c.outputPath, childId);
  broadcastChildStatusChanged(c.parentConversationId, childId, c.status, toSnapshot(c));
}

/**
 * conversation 补集条目（内存不跟踪的历史子会话）转 snapshot 形状。
 * status 恒为 stopped、delivered 恒为 false、lastError 恒为 undefined：不在内存即代表本进程未在跑它，
 * 是否交付由主会话上下文记忆与共享区文件判定。
 */
function conversationToSnapshot(
  conv: ConversationIndex,
  profiles: SubAgentProfile[],
): ChildStateSnapshot {
  const profileId = conv.contractMetadata?.subAgentProfileId;
  const profile = profileId ? profiles.find((p) => p.id === profileId) : undefined;
  return {
    childId: conv.id,
    parentConversationId: conv.parentConversationId ?? '',
    groupId: conv.groupId ?? '',
    outputPath: conv.contractMetadata?.expectedOutputPath ?? '',
    task: conv.contractMetadata?.task ?? '',
    title: conv.title,
    status: 'stopped',
    delivered: false,
    startedAt: Date.parse(conv.createdAt) || 0,
    profileName: profile?.name ?? '默认',
    sessionId: conv.sessionId ?? undefined,
  };
}

/**
 * 内存 childStates 为主，conversation-service 补集合并：
 * 重启后内存丢失的历史子会话仍能被 ListLinkedSessions / 前端列表看到。
 * 去重键 childId，内存优先；补集按 updatedAt 降序只保留最近 10 条，
 * task/outputPath 从 contractMetadata 补、profileName 从 subAgentProfileId 反查 settings，
 * status 恒为 stopped、delivered 恒为 false（交付判定靠主会话上下文记忆与共享区文件，不在运行时）。
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
  const recent = [...extra]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);
  return [...memoryChildren, ...recent.map((conv) => conversationToSnapshot(conv, profiles))];
}

/**
 * 应用重启后（内存 childStates 清空）从磁盘 conversation 记录降级重建跟踪条目：
 * status 恒 stopped、delivered 恒 false（运行时视角语义，同 conversationToSnapshot），不挂计时器、不广播
 * （UI 列表由 getChildrenByParent 的磁盘补集覆盖，rehydrate 不产生可见状态变化，resumeChild 复活时才广播 running）；
 * 之后 resumeChild 与进程内路径完全一致（re-claim outputPath、重挂 timeout/idle 计时器均由其负责）。
 * 幂等：已在跟踪中直接返回现有快照；非 agent 派出的会话不可重建，返回 null。
 */
export async function rehydrateChildState(workspaceId: string, conv: ConversationIndex): Promise<ChildStateSnapshot | null> {
  const existing = childStates.get(conv.id);
  if (existing) return toSnapshot(existing);
  if (conv.role !== 'sub' || !conv.contractMetadata) return null;
  const settings = await loadSettings();
  const profiles: SubAgentProfile[] = settings.subAgent?.profiles ?? [];
  const c: ChildStateInternal = {
    ...conversationToSnapshot(conv, profiles),
    sessionId: conv.sessionId ?? '',
    workspaceId,
    attachmentId: '',
    consecutiveFails: 0,
  };
  childStates.set(c.childId, c);
  return toSnapshot(c);
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

// ─── 通用消息投递（dogear__SendMessage 的运行时支撑） ───

export interface DeliverMessageOptions {
  toConversationId: string;
  fromSessionId: string;
  fromLabel: string;
  message: string;
  delivery: boolean;
  /** 注入类型标记，缺省按 delivery 布尔映射（true→delivery / false→reply） */
  tag?: InjectionTag;
}

/**
 * 'queued'：消息已推入目标会话（running 时 steer 排队、idle 时 prompt 立即生效）
 * 'target_inactive'：目标会话当前未运行（未打开/已关闭），消息未能送达
 */
export type DeliverMessageOutcome = 'queued' | 'target_inactive';

/**
 * 消息注入出口：把消息作为目标会话的新输入推进下一轮（running 时 PiSession.sendMessage 内部转
 * steer 排队、idle 时 prompt 立即生效）。deliverMessage 与终态通知注入共用。
 * 推送失败只记日志不抛出：异步 fire-and-forget，终态结算路径不能因注入失败中断。
 */
function pushToParentSession(toConversationId: string, msg: Omit<DeliverMessageOptions, 'toConversationId'>): boolean {
  const localSessionId = getPiSessionManager().getSessionIdByConversation(toConversationId);
  const session = localSessionId ? getPiSessionManager().getSession(localSessionId) : undefined;
  if (!session) return false;

  const tag = msg.tag ?? deliveryToTag(msg.delivery);
  const text = `${buildSenderTag(msg.fromSessionId, msg.fromLabel, msg.delivery, tag)}\n${msg.message}`;
  session.sendMessage(text, { injectionTag: tag }).catch((err: unknown) => {
    logger.warn(`消息推送失败 (${toConversationId})`, err);
  });
  return true;
}

export function deliverMessage(opts: DeliverMessageOptions): DeliverMessageOutcome {
  return pushToParentSession(opts.toConversationId, opts) ? 'queued' : 'target_inactive';
}

/** 转义 XML 属性值中的特殊字符 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function deliveryToTag(delivery: boolean): InjectionTag {
  return delivery ? 'delivery' : 'reply';
}

function buildSenderTag(fromSessionId: string, fromLabel: string, delivery: boolean, tag?: InjectionTag): string {
  const tagAttr = tag ? ` tag="${escapeXmlAttr(tag)}"` : '';
  return `<sender kind="agent" session_id="${escapeXmlAttr(fromSessionId)}" name="${escapeXmlAttr(fromLabel)}" delivery="${delivery ? 'true' : 'false'}"${tagAttr}/>`;
}

/**
 * SendMessage 打停机直派子会话时的自动调起编排（工具层调用）：复用 resumeChild 拉起会话，
 * 唤醒输入用 sender 标签包装的追问原文而非「中断续跑」模板——追问语境下「你因中断停止」是错误提示。
 * 不在本进程运行时跟踪（如应用重启后）直接抛错，由工具层回退为「暂收不到」提示。
 */
export async function resumeChildAndDeliver(
  childId: string,
  deliverOpts: Omit<DeliverMessageOptions, 'toConversationId'>,
): Promise<void> {
  const c = childStates.get(childId);
  if (!c) throw new Error(`会话 ${childId} 不在本进程运行时跟踪中，无法自动调起`);
  const tag = deliverOpts.tag ?? deliveryToTag(deliverOpts.delivery);
  await resumeChild(childId, {
    reason: '主会话 SendMessage 自动调起',
    wakeupMessage: `${buildSenderTag(deliverOpts.fromSessionId, deliverOpts.fromLabel, deliverOpts.delivery, tag)}\n${deliverOpts.message}`,
    wakeupTag: tag,
  });
}

/**
 * 父会话被调起后拿到新 sessionId，对仍 running 的直属子会话把非 UI 保活重挂到新 sessionId，
 * 保证「有 running 子会话期间父会话存活」的语义延续（否则调起后的父会话可能再次被销毁）。
 * 旧 sessionId 的 hold 已随 session 销毁清除，直接覆盖 parentHoldSessionId，无需先 release。
 */
function reacquireParentHolds(parentConversationId: string, newSessionId: string): void {
  const manager = getPiSessionManager();
  for (const c of childStates.values()) {
    if (c.parentConversationId !== parentConversationId || c.status !== 'running') continue;
    if (c.parentHoldSessionId === newSessionId) continue;
    if (manager.acquireHold(newSessionId)) {
      c.parentHoldSessionId = newSessionId;
    }
  }
}

/**
 * 自动调起停机的父会话并注入消息（子会话交付/终态通知的兑底，即「唤醒即续跑」）：
 * attach 拉起 → 重挂 running 子会话保活 → 注入 sender 标签包装的消息；
 * 注入的这轮 settled 后释放 bridge 持有的 attachment 引用——有保活时引用归零仍存活，
 * 无保活（最后一个子会话的终态通知）时自然回收，不永久持有父会话。
 */
export async function resumeParentAndDeliver(
  parentConversationId: string,
  workspaceId: string,
  deliverOpts: Omit<DeliverMessageOptions, 'toConversationId'>,
): Promise<void> {
  const attachment = await conversationRuntimeService.attachConversation(parentConversationId, workspaceId, 'desktop', {});
  const session = getPiSessionManager().getSession(attachment.sessionId);
  if (!session) {
    try { conversationRuntimeService.detachAttachment(attachment.attachmentId); } catch { /* ignore */ }
    throw new Error(`父会话 ${parentConversationId} 拉起失败: ${attachment.sessionId}`);
  }
  reacquireParentHolds(parentConversationId, attachment.sessionId);
  const releaseRef = () => {
    session.off('settled', releaseRef);
    conversationRuntimeService.detachAttachment(attachment.attachmentId);
  };
  session.on('settled', releaseRef);
  logger.info(`自动调起停机父会话 ${parentConversationId}（来自 ${deliverOpts.fromLabel}，delivery=${deliverOpts.delivery}）`);
  const tag = deliverOpts.tag ?? deliveryToTag(deliverOpts.delivery);
  session.sendMessage(`${buildSenderTag(deliverOpts.fromSessionId, deliverOpts.fromLabel, deliverOpts.delivery, tag)}\n${deliverOpts.message}`, { injectionTag: tag }).catch((err: unknown) => {
    logger.warn(`父会话 ${parentConversationId} 调起后消息注入失败`, err);
  });
}
