/**
 * 任务串行队列执行器：取 queued 任务 → 创建执行会话（role='main' 普通会话）→ 按任务提示词实施
 * → 等待本轮结束（sendMessage promise = PiSession complete 信号）→ 结果写回 → review + 系统通知。
 *
 * - 串行：单实例 drain 循环，一次只跑一个任务
 * - 结束信号：await sendMessage 即一轮跑完（finally 中 emit complete 后 promise 才 resolve），
 *   辅以一次性 complete 监听拿 PiSessionTurnResult 判定成败；空闲超时兜底（长时间无任何消息，防多 step 长任务被整轮墙钟误杀）走 session.interrupt()
 *   注入 cancelled 终局，避免 adapter.prompt 卡死导致队列永久阻塞
 * - 结果摘要：执行提示词约定 agent 在回复末尾输出 <task-result> 标签段，主进程从本轮 text
 *   增量累积中提取；未命中标签时回退本轮文本尾部
 */
import * as workspaceJsonService from './workspace-json-service.js';
import * as conversationService from './conversation-service.js';
import fs from 'node:fs/promises';
import { conversationRuntimeService } from './conversation-runtime-service.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import type { PiSession, PiSessionTurnResult } from '../agents/pi-session/pi-session.js';
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import { mainLogger } from '../agents/logger.js';
import { getSessionNotificationService } from './session-notification-service.js';
import * as taskService from './task-service.js';
import type { Task } from './task-service.js';

const log = mainLogger.child('task-queue');

const EXEC_IDLE_TIMEOUT_MS = 2 * 60 * 60_000;

const RESULT_TAG_RE = /<task-result>([\s\S]*?)<\/task-result>/;

const RESULT_TAIL_MAX = 2000;

interface QueuedWork {
  workspacePath: string;
  workspaceId: string;
  task: Task;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractResultSummary(text: string): string {
  const tagged = text.match(RESULT_TAG_RE);
  if (tagged?.[1].trim()) return tagged[1].trim();
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.length > RESULT_TAIL_MAX ? trimmed.slice(-RESULT_TAIL_MAX) : trimmed;
}

function firstLine(text: string, max = 80): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > max ? line.slice(0, max) + '…' : line;
}

function buildExecutionPrompt(task: Task): string {
  return [
    '<task-execution>',
    '你是任务系统自动创建的执行会话，全权负责把下述计划实施完毕。无人值守：用户不在线，不要中途停下等确认，推进到整个计划完成。',
    '用户可能打开本会话查看过程或插话，插话按正常对话回应。',
    '',
    `任务标题：${task.title}`,
    `任务 ID：${task.id}`,
    `计划文档：${task.planPath}`,
    '',
    '执行模式：',
    '- 计划为 stepN 分步结构（stepN-*.md）时，你是 staged-execution skill 语境里的「主会话」：逐 step 派子会话实施、验收、回填 stepN.md、逐 step commit，不等用户确认直接进下一步',
    '- 单文档小计划直接自己实施',
    '- 派出子会话后必须用 dogear__WaitForMessage 挂起等待交付，不要停回复等待——你结束回合即任务轮结束，任务会直接进入待审核',
    '',
    '执行要求：',
    '1. 先读计划文档再实施；计划引用的其他文件按需读取',
    '2. 计划文档不存在或明显无法实施时不要硬做，直接说明原因结束本轮',
    '3. 整个计划实施完成后，在回复末尾用 <task-result></task-result> 标签输出结果摘要（做了什么、关键改动位置、遗留问题）；系统会把这段写回任务结果供用户审核',
    '</task-execution>',
  ].join('\n');
}

class TaskQueueExecutor {
  private draining = false;
  private rekick = false;

  kick(): void {
    if (this.draining) {
      this.rekick = true;
      return;
    }
    this.draining = true;
    void this.drain().finally(() => {
      this.draining = false;
      if (this.rekick) {
        this.rekick = false;
        this.kick();
      }
    });
  }

  private async drain(): Promise<void> {
    for (;;) {
      const next = await this.pickNext();
      if (!next) return;
      log.info(`取出任务 ${next.task.id}《${next.task.title}》执行`);
      try {
        await this.executeOne(next);
      } catch (err) {
        log.error(`任务 ${next.task.id} 执行异常`, err);
        await this.safeReject(next, `执行器内部错误: ${errorMessage(err)}`);
      }
    }
  }

  private async pickNext(): Promise<QueuedWork | null> {
    const workspaces = await workspaceJsonService.getAll();
    let best: QueuedWork | null = null;
    for (const ws of workspaces) {
      let tasks: Task[];
      try {
        tasks = await taskService.listTasks(ws.path);
      } catch {
        continue;
      }
      for (const task of tasks) {
        if (task.status !== 'queued') continue;
        if (!best || task.createdAt < best.task.createdAt) {
          best = { workspacePath: ws.path, workspaceId: ws.id, task };
        }
      }
    }
    return best;
  }

  private async executeOne(ctx: QueuedWork): Promise<void> {
    const { workspacePath, workspaceId, task } = ctx;
    if (!task.planPath) {
      await this.safeReject(ctx, '任务尚无 plan 文档，请先补文档再执行');
      return;
    }
    try {
      await fs.access(task.planPath);
    } catch {
      await this.safeReject(ctx, '任务尚无 plan 文档，请先补文档再执行');
      return;
    }
    const origin = task.originSessionId
      ? await conversationService.getByIdGlobal(task.originSessionId)
      : null;
    if (!origin?.conv.groupId) {
      await this.safeReject(ctx, '找不到产生任务的会话或其所属话题，无法创建执行会话');
      return;
    }

    let execId: string;
    try {
      execId = await conversationService.create(
        origin.workspaceId,
        origin.conv.groupId,
        `任务: ${task.title}`,
        origin.conv.modelSelection,
        { role: 'main' },
      );
    } catch (err) {
      await this.safeReject(ctx, `创建执行会话失败: ${errorMessage(err)}`);
      return;
    }

    const running = await taskService.markTaskRunning(workspacePath, task.id, execId);

    let attachment: Awaited<ReturnType<typeof conversationRuntimeService.attachConversation>>;
    try {
      attachment = await conversationRuntimeService.attachConversation(execId, origin.workspaceId, 'desktop', {});
    } catch (err) {
      await this.safeReject(ctx, `拉起执行会话失败: ${errorMessage(err)}`);
      return;
    }
    const session = getPiSessionManager().getSession(attachment.sessionId);
    if (!session) {
      conversationRuntimeService.detachAttachment(attachment.attachmentId);
      await this.safeReject(ctx, '执行会话 session 拉起失败');
      return;
    }

 // 无人值守执行：不弹权限确认；任务轮结束后恢复原模式，避免用户接管会话时仍处于全自动
    const previousPermissionMode = session.getPermissionMode();
    session.setPermissionMode('autoExecute');

    const outcome = await this.runExecutionTurn(session, running);
    void session.setPermissionMode(previousPermissionMode).catch(() => {});

    // 一轮已 complete，无需保活；用户插话导致的剩余轮次由 orphan 保活机制自然收尾
    conversationRuntimeService.detachAttachment(attachment.attachmentId);

    if (outcome.subtype !== 'success') {
      const reason = outcome.error?.message ?? `执行轮次异常结束（${outcome.subtype}）`;
      await this.safeReject(ctx, reason);
      return;
    }

    const summary = extractResultSummary(outcome.text);
    // 取消竞态保护：写回前重查状态，已被取消（回 backlog）则丢弃结果
    const current = await taskService.getTask(workspacePath, task.id);
    if (!current || current.status !== 'running') {
      log.info(`任务 ${task.id} 已被用户取消（当前 ${current?.status ?? '不存在'}），丢弃执行结果`);
      return;
    }
    const reviewed = await taskService.completeTask(workspacePath, task.id, summary);
    log.info(`任务 ${task.id} 执行完成，进入 review（执行会话 ${execId}）`);
    this.notify(reviewed, workspaceId, `任务待审核：${reviewed.title}`, firstLine(reviewed.result ?? ''));
  }

  private async runExecutionTurn(session: PiSession, task: Task): Promise<{ subtype: PiSessionTurnResult['subtype']; error?: { message: string }; text: string }> {
    let turnResult: PiSessionTurnResult = { subtype: 'success' };
    let text = '';
    const onComplete = (r: PiSessionTurnResult) => {
      turnResult = r;
    };
    // 空闲保险丝而非整轮墙钟：正常推进（含挂起等子会话）持续有消息流动续命，仅真卡死时静默到上限 interrupt 解锁队列
    const fireIdleTimeout = () => {
      log.warn(`任务 ${task.id} 执行会话 ${EXEC_IDLE_TIMEOUT_MS}ms 无任何消息，判定卡死，中断执行会话`);
      void session.interrupt().catch(() => {});
    };
    let idleTimer = setTimeout(fireIdleTimeout, EXEC_IDLE_TIMEOUT_MS);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(fireIdleTimeout, EXEC_IDLE_TIMEOUT_MS);
    };
    const onMessage = (m: ExtendedSessionMessage) => {
      resetIdleTimer();
      if (m.type === 'text') text += m.content ?? '';
    };
    session.once('complete', onComplete);
    session.on('message', onMessage);
    try {
      await session.sendMessage(buildExecutionPrompt(task));
    } catch (err) {
      turnResult = { subtype: 'failed', error: { kind: 'runtime', message: errorMessage(err) } };
    } finally {
      clearTimeout(idleTimer);
      session.off('complete', onComplete);
      session.off('message', onMessage);
    }
    return { subtype: turnResult.subtype, error: turnResult.error, text };
  }

  private async safeReject(ctx: QueuedWork, reason: string): Promise<void> {
    try {
      const current = await taskService.getTask(ctx.workspacePath, ctx.task.id);
      if (current && !['queued', 'running'].includes(current.status)) {
        log.info(`任务 ${ctx.task.id} 当前状态为 ${current.status}，跳过置 rejected（可能已被取消）`);
        return;
      }
      const rejected = await taskService.rejectTask(ctx.workspacePath, ctx.task.id, reason);
      log.warn(`任务 ${ctx.task.id} 置为 rejected: ${reason}`);
      this.notify(rejected, ctx.workspaceId, `任务执行失败：${rejected.title}`, firstLine(reason));
    } catch (err) {
      log.warn(`任务 ${ctx.task.id} 置 rejected 失败（可能已被并发处理）`, err);
    }
  }

  private notify(task: Task, workspaceId: string, title: string, body: string): void {
    getSessionNotificationService().notify({
      kind: 'complete',
      notificationId: `task-${task.id}-${task.status}-${task.updatedAt}`,
      conversationId: task.execSessionId ?? '',
      workspaceId,
      title,
      body,
      taskId: task.id,
    });
  }
}

let executor: TaskQueueExecutor | null = null;

export function getTaskQueue(): TaskQueueExecutor {
  if (!executor) executor = new TaskQueueExecutor();
  return executor;
}

/** 中断执行会话当前轮（任务取消用）；会话不存在时静默跳过，状态迁移由调用方负责 */
export async function interruptTaskExecSession(conversationId: string): Promise<void> {
  const piSessionManager = getPiSessionManager();
  const sessionId = piSessionManager.getSessionIdByConversation(conversationId);
  const session = sessionId ? piSessionManager.getSession(sessionId) : undefined;
  if (!session) return;
  try {
    await session.interrupt();
  } catch (err) {
    log.warn(`中断执行会话 ${conversationId} 失败`, err);
  }
}

/** 应用启动：各工作区遗留 running 置回 queued 后 kick 队列 */
export async function recoverAndStartTaskQueue(): Promise<void> {
  const workspaces = await workspaceJsonService.getAll();
  for (const ws of workspaces) {
    try {
      const recovered = await taskService.recoverInterruptedTasks(ws.path);
      if (recovered > 0) log.info(`工作区 ${ws.id} 恢复 ${recovered} 个中断任务回 queued`);
    } catch (err) {
      log.warn(`工作区 ${ws.id} 任务恢复失败`, err);
    }
  }
  getTaskQueue().kick();
}
