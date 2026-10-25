import { mainLogger } from '../../../agents/logger.js';
import type { ExtendedSessionMessage } from '../../../agents/task-types.js';
import type { PiSession, PiSessionTurnResult } from '../../../agents/pi-session/pi-session.js';
import type { ConversationUsageEntry } from '../../../types.js';
import { loadSettings } from '../../settings-service.js';
import {
  getById as getWorkspaceById,
  getDefault as getDefaultWorkspace,
} from '../../workspace-json-service.js';
import * as conversationService from '../../conversation-service.js';
import { getOrCreateHiddenGroup } from '../../group-service.js';
import { getSessionNotificationService } from '../../session-notification-service.js';
import { buildCustomAgentPrompt } from '../custom-agent-prompt.js';
import type {
  RunTokens,
  ScheduledTask,
} from '../types.js';

// 与 task-queue 执行会话同款看护参数：空闲超时兜底 + interrupt 后强制放行
const EXEC_IDLE_TIMEOUT_MS = 2 * 60 * 60_000;
const FORCE_RELEASE_DELAY_MS = 60_000;

export interface TaskExecResult {
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string;
  error?: string;
  tokens?: RunTokens;
}

export interface TriggerContext {
  conversationId: string;
}

export interface TaskExecuteHooks {
  onConversationId?: (id: string) => void;
  triggerContext?: TriggerContext;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatRunStamp(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function addTokens(acc: RunTokens | undefined, entry: ConversationUsageEntry): RunTokens {
  const usage = entry.usage;
  const next: RunTokens = {
    inputTokens: (acc?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (acc?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
  };
  if (usage.cacheReadInputTokens) next.cacheReadInputTokens = (acc?.cacheReadInputTokens ?? 0) + usage.cacheReadInputTokens;
  if (usage.cacheCreationInputTokens) next.cacheCreationInputTokens = (acc?.cacheCreationInputTokens ?? 0) + usage.cacheCreationInputTokens;
  return next;
}

function notifyRunFinished(task: ScheduledTask, workspaceId: string, conversationId: string, res: TaskExecResult): void {
  const failed = res.status === 'failed';
  const title = failed ? `定时任务失败：${task.name}` : `定时任务完成：${task.name}`;
  const body = res.error ?? res.summary ?? '运行结束';
  const service = getSessionNotificationService();
  service.notify({
    kind: 'complete',
    notificationId: `scheduler-task-${task.id}-${Date.now()}`,
    conversationId,
    workspaceId,
    title,
    body,
  });
  service.playCue(failed ? 'error' : 'complete');
  void conversationService.markUnreadIfNotFocused(conversationId, failed ? 'error' : 'reply');
}

export async function executeTask(task: ScheduledTask, hooks?: TaskExecuteHooks): Promise<TaskExecResult> {
  const workspace = task.workspaceId !== undefined
    ? await getWorkspaceById(task.workspaceId)
    : await getDefaultWorkspace();
  if (!workspace) {
    return {
      status: 'failed',
      error: task.workspaceId !== undefined
        ? `工作区不存在: ${task.workspaceId}`
        : '未设置默认工作区，且任务未指定工作区',
    };
  }
  const settings = await loadSettings();
  const modelSelection = task.modelSelection ?? settings.ai.defaultModelSelection ?? undefined;
  if (!modelSelection) {
    return { status: 'failed', error: '未配置模型：任务未设置 modelSelection 且全局默认模型为空' };
  }

  const group = await getOrCreateHiddenGroup(workspace.id, '定时');
  const conversationId = await conversationService.create(
    workspace.id,
    group.id,
    `${task.name} · ${formatRunStamp(Date.now())}`,
    modelSelection,
    { role: 'main', executor: true, schedulerTaskId: task.id },
  );
  hooks?.onConversationId?.(conversationId);

  // 动态 import 打断 tool-assembly → scheduler-tools → scheduler-service → 本文件的静态环
  const { conversationRuntimeService } = await import('../../conversation-runtime-service.js');
  const { getPiSessionManager } = await import('../../../agents/pi-session/pi-session-manager.js');

  let attachment: Awaited<ReturnType<typeof conversationRuntimeService.attachConversation>>;
  try {
    attachment = await conversationRuntimeService.attachConversation(conversationId, workspace.id, 'desktop', {
      skillsOverride: task.skillsOverride,
      enabledToolPacksOverride: task.toolPacksOverride,
    });
  } catch (err) {
    return { status: 'failed', error: `拉起运行会话失败: ${errorMessage(err)}` };
  }
  const session = getPiSessionManager().getSession(attachment.sessionId);
  if (!session) {
    conversationRuntimeService.detachAttachment(attachment.attachmentId);
    return { status: 'failed', error: '运行会话 session 拉起失败' };
  }

  session.takeOverForUnattended();
  let result: TaskExecResult;
  try {
    result = await runTurn(session, task);
  } finally {
    session.restoreFromUnattended();
    conversationRuntimeService.detachAttachment(attachment.attachmentId);
  }
  mainLogger.info(`[scheduler] 自定义任务结束: ${task.name} status=${result.status} conversation=${conversationId}`);
  if (result.status !== 'cancelled') notifyRunFinished(task, workspace.id, conversationId, result);
  return result;
}

/**
 * 单轮执行看护（task-queue runExecutionTurn 同款）：
 * sendMessage 一轮 + complete 监听取终态；空闲超时（长时间无任何消息）interrupt 注入 cancelled 终局，
 * interrupt 后 60s 未收尾强制放行（pi 内部 promise 挂死时不拖死任务）；assistant 文本按消息边界分段，
 * 末段即结果自述；usage 事件累计 token 用量。
 */
async function runTurn(session: PiSession, task: ScheduledTask): Promise<TaskExecResult> {
  let turnResult: PiSessionTurnResult = { subtype: 'success' };
  const onComplete = (r: PiSessionTurnResult) => {
    turnResult = r;
  };

  const textSegments: string[] = [];
  let currentText = '';
  const onMessage = (m: ExtendedSessionMessage) => {
    if (m.type === 'text') {
      currentText += m.content ?? '';
      return;
    }
    // assistant 消息落盘标记 = 文本段边界；末段即结果自述
    if (m.type === 'message_id' && m.role === 'assistant') {
      if (currentText.trim()) textSegments.push(currentText);
      currentText = '';
    }
  };

  let tokens: RunTokens | undefined;
  const onUsage = (payload: { conversationId?: string; entry: ConversationUsageEntry }) => {
    tokens = addTokens(tokens, payload.entry);
  };

  let idleTimedOut = false;
  let forceReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  let release!: (value: 'forced') => void;
  const forcedRelease = new Promise<'forced'>((resolve) => {
    release = () => resolve('forced');
  });
  const fireIdleTimeout = () => {
    idleTimedOut = true;
    mainLogger.warn(`[scheduler] 任务 ${task.name} 运行会话 ${EXEC_IDLE_TIMEOUT_MS}ms 无任何消息，判定卡死，中断运行会话`);
    void session.interrupt().catch(() => {});
    forceReleaseTimer = setTimeout(() => {
      mainLogger.warn(`[scheduler] 任务 ${task.name} interrupt 后 ${FORCE_RELEASE_DELAY_MS}ms 仍未收尾，强制放行`);
      release('forced');
    }, FORCE_RELEASE_DELAY_MS);
  };
  let idleTimer = setTimeout(fireIdleTimeout, EXEC_IDLE_TIMEOUT_MS);
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(fireIdleTimeout, EXEC_IDLE_TIMEOUT_MS);
  };
  const onActivity = () => resetIdleTimer();

  session.once('complete', onComplete);
  session.on('message', onMessage);
  session.on('message', onActivity);
  session.on('usage', onUsage);
  try {
    const sendPromise = session.sendMessage(buildCustomAgentPrompt({ taskName: task.name, prompt: task.prompt }));
    // 放行胜出后 sendPromise 可能永远不 settle 或迟 reject，提前挂空 catch 防 unhandledRejection
    void sendPromise.catch(() => {});
    const winner = await Promise.race([sendPromise, forcedRelease]);
    if (winner === 'forced') {
      turnResult = { subtype: 'cancelled', error: { kind: 'runtime', message: '运行会话长时间无响应，已强制收尾' } };
    }
  } catch (err) {
    turnResult = { subtype: 'failed', error: { kind: 'runtime', message: errorMessage(err) } };
  } finally {
    clearTimeout(idleTimer);
    if (forceReleaseTimer) clearTimeout(forceReleaseTimer);
    session.off('complete', onComplete);
    session.off('message', onMessage);
    session.off('message', onActivity);
    session.off('usage', onUsage);
  }

  const summary = (textSegments.length > 0 ? textSegments[textSegments.length - 1] : currentText).trim().slice(0, 500) || undefined;
  if (turnResult.subtype === 'cancelled') {
    return { status: 'cancelled', error: idleTimedOut ? '空闲超时，已中断' : turnResult.error?.message ?? '已取消', tokens };
  }
  if (turnResult.subtype === 'failed') {
    return { status: 'failed', error: turnResult.error?.message ?? '任务失败', tokens };
  }
  return { status: 'completed', summary, tokens };
}
