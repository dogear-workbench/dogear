/**
 * 任务串行队列执行器：取 queued 任务 → 创建执行会话（role='main' 普通会话）→ 按任务提示词实施
 * → 占用队列直到任务终态（第一轮 + 看护循环）→ 申报制结算。
 *
 * - 真串行：单实例 drain 循环，executeOne 不返回就不取下一个任务；running 任务真实占用队列
 *   （子会话等待与续跑轮都在 executeOne 内看护），排队 = 真排队。冲突单位是 git 工作区而非文件，
 *   并行会导致多执行会话共享未提交改动池互相污染 commit
 * - 第一轮：await sendMessage 即一轮跑完（finally 中 emit complete 后 promise 才 resolve），
 *   辅以一次性 complete 监听拿 PiSessionTurnResult 判定成败；空闲超时兜底（长时间无任何消息，防多 step 长任务被整轮墙钟误杀）走 session.interrupt()
 *   注入 cancelled 终局，避免 adapter.prompt 卡死导致队列永久阻塞；interrupt 后 60s 仍未收尾则强制放行（Promise.race）解锁队列，
 *   pi 内部 promise 挂死时不拖死后续任务
 * - 看护循环（superviseUntilTerminal）：第一轮后有 running 子会话时继续占用队列，等待源 = 执行会话轮
 *   complete 事件 + 60s tick；任务离开 running（申报/用户取消）即放行；轮结束未申报且无 running
 *   子会话 → interrupted；断链保险丝防注入 fire-and-forget 失败 / waitForIdle 挂死 / 忘申报堵死全队列
 * - 中断语义：markTaskRunning 之后的意外中断（执行轮异常/卡死）置 interrupted（safeInterrupt）交用户手动处置；
 *   执行前的确定性拒绝（无 plan/无 origin 等）仍置 rejected（safeReject）
 * - 申报制结算：review 唯一入口是执行会话调用 dogear__ReportTaskResult 申报，队列不判断成功
 */
import * as workspaceJsonService from './workspace-json-service.js';
import * as conversationService from './conversation-service.js';
import fs from 'node:fs/promises';
import { conversationRuntimeService } from './conversation-runtime-service.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import type { PiSession, PiSessionTurnResult } from '../agents/pi-session/pi-session.js';
import { mainLogger } from '../agents/logger.js';
import { getSessionNotificationService } from './session-notification-service.js';
import { getNotificationCenterService } from './notification-center-service.js';
import { getChildrenByParent } from '../agents/delegation-bridge.js';
import * as taskService from './task-service.js';
import { resolvePlanPath } from './task-store.js';
import { getOrCreateHiddenGroup } from './group-service.js';
import type { Task } from './task-service.js';
import { buildExecutionPrompt, type ExecProfile } from './task-execution-prompt.js';

const log = mainLogger.child('task-queue');

const EXEC_IDLE_TIMEOUT_MS = 2 * 60 * 60_000;

const FORCE_RELEASE_DELAY_MS = 60_000;

const SUPERVISE_TICK_MS = 60_000;

// 防死不防慢：链路实锤断法（注入 fire-and-forget 无重试、pi waitForIdle 挂死）会让死任务永远 running 堵死全队列，
// 与第一轮 EXEC_IDLE_TIMEOUT_MS 同量级兜底；正常流程无任何时间门槛
const SUPERVISE_CHAIN_FUSE_MS = 2 * 60 * 60_000;

// 执行会话 skill 按任务类型查表恒传（skillsOverride 绕过工作区 enabledSkills 与包总闸）：default 空清单=基础版，
// code-impl 两 skill 同时挂载，分步与否由 plan 文档形态决定（stepN-*.md=分步），执行会话按 planPath 形态自行选用，同时挂载仅增索引成本
const EXEC_PROFILE_SKILLS: Record<ExecProfile, readonly string[]> = {
  'code-impl': ['code-discipline', 'staged-execution'],
  default: [],
};

// 会话索引存在跨进程并发写窗口（旧快照短暂覆盖/读失败静默返空），origin 瞬时缺失重试可自愈，避免误拒
const ORIGIN_RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

interface QueuedWork {
  workspacePath: string;
  workspaceId: string;
  task: Task;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function firstLine(text: string, max = 80): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > max ? line.slice(0, max) + '…' : line;
}

// 老会话不知道申报约定，中断类通知带引导句供用户插话时补线
const REPORT_RESULT_HINT = '让会话继续时，完成后请它调用 dogear__ReportTaskResult 申报完成';

function notifyTask(task: Task, workspaceId: string, title: string, body: string): void {
  const service = getSessionNotificationService();
  service.notify({
    kind: 'complete',
    notificationId: `task-${task.id}-${task.status}-${task.updatedAt}`,
    conversationId: task.execSessionId ?? '',
    workspaceId,
    title,
    body,
    taskId: task.id,
  });
  service.playCue('error');
  if (task.execSessionId) void conversationService.markUnreadIfNotFocused(task.execSessionId);
  void getNotificationCenterService().add({
    type: 'task',
    dedupeKey: `task:${task.id}:failed`,
    title,
    summary: body,
    owner: { kind: 'system' },
    taskId: task.id,
    execSessionId: task.execSessionId,
    workspaceId,
    ownerLabel: '系统',
  });
}

function notifyTaskInterrupted(task: Task, workspaceId: string, reason: string): void {
  const title = `任务已中断：${task.title}`;
  const body = `${firstLine(reason)}。${REPORT_RESULT_HINT}`;
  const service = getSessionNotificationService();
  service.notify({
    kind: 'complete',
    notificationId: `task-${task.id}-${task.status}-${task.updatedAt}`,
    conversationId: task.execSessionId ?? '',
    workspaceId,
    title,
    body,
    taskId: task.id,
  });
  service.playCue('error');
  if (task.execSessionId) void conversationService.markUnreadIfNotFocused(task.execSessionId);
  void getNotificationCenterService().add({
    type: 'task',
    dedupeKey: `task:${task.id}:interrupted`,
    title,
    summary: body,
    owner: { kind: 'system' },
    taskId: task.id,
    execSessionId: task.execSessionId,
    workspaceId,
    ownerLabel: '系统',
  });
}

async function resolveOriginWithRetry(originSessionId: string) {
  for (let attempt = 0; ; attempt++) {
    const origin = await conversationService.getByIdGlobal(originSessionId);
    if (origin) return origin;
    if (attempt >= ORIGIN_RETRY_DELAYS_MS.length) return null;
    const delay = ORIGIN_RETRY_DELAYS_MS[attempt];
    log.warn(
      `产生任务的会话 ${originSessionId} 未查到（第 ${attempt + 1}/${ORIGIN_RETRY_DELAYS_MS.length + 1} 次），${delay}ms 后重试`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
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
        const reason = `执行器内部错误: ${errorMessage(err)}`;
        const current = await taskService.getTask(next.workspaceId, next.task.id);
        if (current?.status === 'running') await this.safeInterrupt(next, reason);
        else await this.safeReject(next, reason);
      }
    }
  }

  private async pickNext(): Promise<QueuedWork | null> {
    const workspaces = await workspaceJsonService.getAll();
    let best: QueuedWork | null = null;
    for (const ws of workspaces) {
      let tasks: Task[];
      try {
        tasks = await taskService.listTasks(ws.id);
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
    const { workspacePath, task } = ctx;
    if (!task.planPath) {
      await this.safeReject(ctx, '任务尚无 plan 文档，请先补文档再执行');
      return;
    }
    const planPath = resolvePlanPath(workspacePath, task.planPath);
    try {
      await fs.access(planPath);
    } catch {
      await this.safeReject(ctx, '任务尚无 plan 文档，请先补文档再执行');
      return;
    }
    if (!task.originSessionId) {
      await this.safeReject(ctx, '任务缺少产生会话记录（originSessionId），无法创建执行会话');
      return;
    }
    const origin = await resolveOriginWithRetry(task.originSessionId);
    if (!origin) {
      await this.safeReject(
        ctx,
        `找不到产生任务的会话 ${task.originSessionId}（已重试 ${ORIGIN_RETRY_DELAYS_MS.length} 次，会话索引可能异常），无法创建执行会话`,
      );
      return;
    }
    let execId: string;
    try {
      const carrierGroup = await getOrCreateHiddenGroup(origin.workspaceId, '任务');
      execId = await conversationService.create(
        origin.workspaceId,
        carrierGroup.id,
        `任务: ${task.title}`,
        origin.conv.modelSelection,
        { role: 'main', executor: true },
      );
    } catch (err) {
      await this.safeReject(ctx, `创建执行会话失败: ${errorMessage(err)}`);
      return;
    }

    const running = await taskService.markTaskRunning(ctx.workspaceId, ctx.workspacePath, task.id, execId);

    let attachment: Awaited<ReturnType<typeof conversationRuntimeService.attachConversation>>;
    try {
      attachment = await conversationRuntimeService.attachConversation(execId, origin.workspaceId, 'desktop', {
        skillsOverride: EXEC_PROFILE_SKILLS[task.execProfile ?? 'default'],
      });
    } catch (err) {
      await this.safeInterrupt(ctx, `拉起执行会话失败: ${errorMessage(err)}`);
      return;
    }
    const session = getPiSessionManager().getSession(attachment.sessionId);
    if (!session) {
      conversationRuntimeService.detachAttachment(attachment.attachmentId);
      await this.safeInterrupt(ctx, '执行会话 session 拉起失败');
      return;
    }

 // 无人值守执行：不弹权限确认；任务轮结束后恢复原模式，避免用户接管会话时仍处于全自动
    const previousPermissionMode = session.getPermissionMode();
    session.setPermissionMode('autoExecute');

    const outcome = await this.runExecutionTurn(session, running, planPath);
    void session.setPermissionMode(previousPermissionMode).catch(() => {});

    // attachment 只保第一轮：看护期不占引用。有 running 子会话时 bridge 侧 hold 保活；
    // 无 hold 被回收后由注入自动调起产生新 session，看护循环每 tick 动态重查（rewire）挂事件
    conversationRuntimeService.detachAttachment(attachment.attachmentId);

    if (outcome.subtype !== 'success') {
      const reason = outcome.error?.message ?? `执行轮次异常结束（${outcome.subtype}）`;
      await this.safeInterrupt(ctx, reason);
      return;
    }

    await this.superviseUntilTerminal(ctx, execId);
  }

  /**
   * 看护循环：第一轮结束后占用队列直到任务离开 running（申报→review / 用户取消）或被 safeInterrupt。
   * 等待源 = 执行会话轮 complete 事件 + 周期 tick；子会话由 delegation-bridge 完备看护，
   * 有 running 直属子会话即继续等。首拍与 complete 判定同义（第一轮/续跑轮刚结束）：未申报且无
   * running 子会话 → interrupted；tick 醒来则只有断链保险丝可触发（防注入丢失、waitForIdle 挂死
   * 堵死队列）。异常向上抛给 drain 的 catch 兜底，队列永不死锁。
   */
  private async superviseUntilTerminal(ctx: QueuedWork, execId: string): Promise<void> {
    const manager = getPiSessionManager();
    let wiredSessionId = '';
    let unwire: (() => void) | undefined;
    let pendingComplete = false;
    let lastActivityAt = Date.now();
    let wake: ((reason: 'complete' | 'tick') => void) | undefined;
    let tickTimer: ReturnType<typeof setTimeout> | undefined;

    const onComplete = () => {
      pendingComplete = true;
      lastActivityAt = Date.now();
      if (wake) wake('complete');
    };
    const onMessage = () => {
      lastActivityAt = Date.now();
    };

    const rewire = () => {
      const sessionId = manager.getSessionIdByConversation(execId);
      if (!sessionId || sessionId === wiredSessionId) return;
      const session = manager.getSession(sessionId);
      if (!session) return;
      unwire?.();
      wiredSessionId = sessionId;
      session.on('complete', onComplete);
      session.on('message', onMessage);
      unwire = () => {
        session.off('complete', onComplete);
        session.off('message', onMessage);
      };
    };

    const waitForWake = (): Promise<'complete' | 'tick'> =>
      new Promise((resolve) => {
        if (pendingComplete) {
          pendingComplete = false;
          resolve('complete');
          return;
        }
        wake = (reason) => {
          wake = undefined;
          clearTimeout(tickTimer);
          if (reason === 'complete') pendingComplete = false;
          resolve(reason);
        };
        tickTimer = setTimeout(() => wake?.('tick'), SUPERVISE_TICK_MS);
      });

    try {
      let wokeBy: 'first' | 'complete' | 'tick' = 'first';
      for (;;) {
        rewire();
        const current = await taskService.getTask(ctx.workspaceId, ctx.task.id);
        if (!current || current.status !== 'running') {
          log.info(`任务 ${ctx.task.id} 看护退出：状态 ${current?.status ?? '不存在'}（执行会话 ${execId}），队列放行`);
          return;
        }
        const children = await getChildrenByParent(execId);
        if (children.some((c) => c.status === 'running')) {
          // running 子会话本身即活动，刷新计时防保险丝误杀（子会话终态后注入断链从此刻起算）
          lastActivityAt = Date.now();
          wokeBy = await waitForWake();
          continue;
        }
        if (wokeBy !== 'tick') {
          await this.safeInterrupt(ctx, '执行会话回合结束，但未申报结果且无运行中的子会话');
          return;
        }
        if (Date.now() - lastActivityAt >= SUPERVISE_CHAIN_FUSE_MS) {
          log.warn(`任务 ${ctx.task.id} 看护保险丝触发：无 running 子会话且 ${SUPERVISE_CHAIN_FUSE_MS / 3_600_000}h 无消息活动（执行会话 ${execId}）`);
          await this.safeInterrupt(ctx, `看护保险丝：执行会话持续 ${SUPERVISE_CHAIN_FUSE_MS / 3_600_000} 小时无消息活动且无运行中的子会话，判定执行链路中断`);
          return;
        }
        wokeBy = await waitForWake();
      }
    } finally {
      clearTimeout(tickTimer);
      unwire?.();
    }
  }

  private async runExecutionTurn(session: PiSession, task: Task, planPath: string): Promise<PiSessionTurnResult> {
    let turnResult: PiSessionTurnResult = { subtype: 'success' };
    const onComplete = (r: PiSessionTurnResult) => {
      turnResult = r;
    };
    let forceReleaseTimer: ReturnType<typeof setTimeout> | undefined;
    let release!: (value: 'forced') => void;
    const forcedRelease = new Promise<'forced'>((resolve) => {
      release = () => resolve('forced');
    });
    // 空闲保险丝而非整轮墙钟：正常推进（含挂起等子会话）持续有消息流动续命，仅真卡死时静默到上限 interrupt 解锁队列
    const fireIdleTimeout = () => {
      log.warn(`任务 ${task.id} 执行会话 ${EXEC_IDLE_TIMEOUT_MS}ms 无任何消息，判定卡死，中断执行会话`);
      void session.interrupt().catch(() => {});
      forceReleaseTimer = setTimeout(() => {
        log.warn(`任务 ${task.id} interrupt 后 ${FORCE_RELEASE_DELAY_MS}ms 仍未收尾（sendMessage promise 挂死），强制放行解锁队列`);
        release('forced');
      }, FORCE_RELEASE_DELAY_MS);
    };
    let idleTimer = setTimeout(fireIdleTimeout, EXEC_IDLE_TIMEOUT_MS);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(fireIdleTimeout, EXEC_IDLE_TIMEOUT_MS);
    };
    const onMessage = () => resetIdleTimer();
    session.once('complete', onComplete);
    session.on('message', onMessage);
    try {
      // default 基础版：空清单，与工作区/场景 skill 配置解耦（空清单经 mountedSkills?.length 判断自然无挂载行）
      const sendPromise = session.sendMessage(
        buildExecutionPrompt({
          title: task.title,
          id: task.id,
          planPath,
          mountedSkills: EXEC_PROFILE_SKILLS[task.execProfile ?? 'default'],
          execProfile: task.execProfile ?? 'default',
        }),
        { injectionTag: 'task-execution' },
      );
      // 放行胜出后 sendPromise 可能永远不 settle 或迟 reject，提前挂空 catch 防 unhandledRejection
      void sendPromise.catch(() => {});
      const winner = await Promise.race([sendPromise, forcedRelease]);
      if (winner === 'forced') {
        turnResult = { subtype: 'cancelled', error: { kind: 'runtime', message: '执行会话长时间无响应，已强制解锁队列' } };
      }
    } catch (err) {
      turnResult = { subtype: 'failed', error: { kind: 'runtime', message: errorMessage(err) } };
    } finally {
      clearTimeout(idleTimer);
      if (forceReleaseTimer) clearTimeout(forceReleaseTimer);
      session.off('complete', onComplete);
      session.off('message', onMessage);
    }
    return turnResult;
  }

  private async safeInterrupt(ctx: QueuedWork, reason: string): Promise<void> {
    try {
      const current = await taskService.getTask(ctx.workspaceId, ctx.task.id);
      if (!current || current.status !== 'running') {
        log.info(`任务 ${ctx.task.id} 当前状态为 ${current?.status ?? '不存在'}，跳过置 interrupted（可能已被并发处理）`);
        return;
      }
      const interrupted = await taskService.interruptTask(ctx.workspaceId, ctx.workspacePath, ctx.task.id, reason);
      log.warn(`任务 ${ctx.task.id} 置为 interrupted: ${reason}`);
      notifyTaskInterrupted(interrupted, ctx.workspaceId, reason);
    } catch (err) {
      log.warn(`任务 ${ctx.task.id} 置 interrupted 失败（可能已被并发处理）`, err);
    }
  }

  private async safeReject(ctx: QueuedWork, reason: string): Promise<void> {
    try {
      const current = await taskService.getTask(ctx.workspaceId, ctx.task.id);
      if (!current || current.status !== 'queued') {
        log.info(`任务 ${ctx.task.id} 当前状态为 ${current?.status ?? '不存在'}，跳过置 rejected（仅执行前确定性拒绝走 rejected）`);
        return;
      }
      const rejected = await taskService.rejectTask(ctx.workspaceId, ctx.workspacePath, ctx.task.id, reason);
      log.warn(`任务 ${ctx.task.id} 置为 rejected: ${reason}`);
      notifyTask(rejected, ctx.workspaceId, `任务执行失败：${rejected.title}`, firstLine(reason));
    } catch (err) {
      log.warn(`任务 ${ctx.task.id} 置 rejected 失败（可能已被并发处理）`, err);
    }
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

/** 应用启动：遗留 running 无条件置 interrupted（交用户手动处置，不自动重跑），逐任务发中断通知后拉起队列 */
export async function recoverAndStartTaskQueue(): Promise<void> {
  const workspaces = await workspaceJsonService.getAll();
  for (const ws of workspaces) {
    try {
      const { recovered, recoveredTasks } = await taskService.recoverInterruptedTasks(ws.id, ws.path);
      if (recovered > 0) {
        log.info(`工作区 ${ws.id} 恢复 ${recovered} 个中断任务（running → interrupted）`);
        for (const task of recoveredTasks) {
          notifyTaskInterrupted(task, ws.id, task.result ?? '应用重启时任务执行中断');
        }
      }
    } catch (err) {
      log.warn(`工作区 ${ws.id} 任务恢复失败`, err);
    }
  }
  getTaskQueue().kick();
}
