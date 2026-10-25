import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mainLogger } from '../../../agents/logger.js';
import type { RunHistoryEntry, ScheduledTask } from '../types.js';
import { updateTaskRunState } from '../plan-store.js';
import { appendHistoryEntry } from '../run-history-store.js';
import { reportDone, reportRunning, reportRunningConversation } from '../../background-activity-service.js';
import { executeTask, type TaskExecResult, type TriggerContext } from './task-executor.js';

export interface RunTaskOptions {
  triggerReason: 'time' | 'condition' | 'manual';
  triggerDesc?: string;
  triggerId?: string;
  triggerContext?: TriggerContext;
}

type StopReason = 'manual' | 'window';

export type TaskRunOutcome = 'completed' | 'failed';

export interface TaskDoneEvent {
  taskId: string;
  outcome: TaskRunOutcome;
}

interface RunningInfo {
  taskName: string;
  conversationId?: string;
  sourceTriggerId?: string;
  stopRequested: boolean;
  stopReason: StopReason;
}

class TaskRunner extends EventEmitter {
  private running = new Map<string, RunningInfo>();

  runTask(task: ScheduledTask, opts: RunTaskOptions): { started: boolean } {
    if (this.running.has(task.id)) {
      mainLogger.warn(`[scheduler] 任务运行中，忽略重复触发: ${task.name} (${task.id})`);
      return { started: false };
    }
    const info: RunningInfo = {
      taskName: task.name,
      sourceTriggerId: opts.triggerId,
      stopRequested: false,
      stopReason: 'manual',
    };
    this.running.set(task.id, info);
    void this.executeSingleTask(task, opts, info);
    return { started: true };
  }

  requestStop(taskId: string, sourceTriggerId?: string): void {
    const info = this.running.get(taskId);
    if (!info) return;
    if (sourceTriggerId !== undefined && info.sourceTriggerId !== sourceTriggerId) return;
    info.stopRequested = true;
    info.stopReason = sourceTriggerId !== undefined ? 'window' : 'manual';
    mainLogger.info(
      `[scheduler] 请求停止任务: ${info.taskName} (${taskId}) 来源=${info.stopReason}`,
    );
    const conversationId = info.conversationId;
    if (!conversationId) return;
    void import('../../../agents/pi-session/pi-session-manager.js')
      .then(({ getPiSessionManager }) => {
        const manager = getPiSessionManager();
        const sessionId = manager.getSessionIdByConversation(conversationId);
        const session = sessionId ? manager.getSession(sessionId) : undefined;
        if (!session) return;
        return session.interrupt();
      })
      .catch((err) => mainLogger.warn('[scheduler] 中断运行会话失败:', err));
  }

  private async appendInterruptedEntry(task: ScheduledTask, opts: RunTaskOptions): Promise<void> {
    const entry: RunHistoryEntry = {
      id: randomUUID(),
      ts: Date.now(),
      planId: task.id,
      planName: task.name,
      source: 'scheduler',
      kind: 'task',
      status: 'interrupted',
      triggerReason: opts.triggerReason,
      triggerDesc: opts.triggerDesc,
      startedAt: task.runState?.cursorStartedAt,
      endedAt: Date.now(),
      summary: '上次运行被中断，续跑时补记',
    };
    await appendHistoryEntry(entry);
  }

  private async appendTaskEntry(
    task: ScheduledTask,
    startedAt: number,
    res: TaskExecResult,
    opts: RunTaskOptions,
    conversationId?: string,
  ): Promise<void> {
    const entry: RunHistoryEntry = {
      id: randomUUID(),
      ts: Date.now(),
      planId: task.id,
      planName: task.name,
      source: 'scheduler',
      kind: 'task',
      conversationId,
      status: res.status,
      triggerReason: opts.triggerReason,
      triggerDesc: opts.triggerDesc,
      startedAt,
      endedAt: Date.now(),
      summary: res.summary,
      error: res.error,
      tokens: res.tokens,
    };
    await appendHistoryEntry(entry);
  }

  private async executeSingleTask(task: ScheduledTask, opts: RunTaskOptions, info: RunningInfo): Promise<void> {
    let outcome: TaskRunOutcome = 'completed';
    try {
      if (typeof task.runState?.cursorStartedAt === 'number') {
        await this.appendInterruptedEntry(task, opts);
      }
      reportRunning(task.id, { source: 'scheduler', name: task.name });
      const startedAt = Date.now();
      await updateTaskRunState(task.id, { cursorStartedAt: startedAt });
      let res: TaskExecResult;
      try {
        res = await executeTask(task, {
          onConversationId: (id) => {
            info.conversationId = id;
            reportRunningConversation(task.id, id);
          },
          triggerContext: opts.triggerContext,
        });
      } catch (err) {
        res = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
      if (info.stopRequested && res.status === 'completed') {
        const suffix = info.stopReason === 'window' ? '（已超出时间窗口，自动停止）' : '（已被手动停止）';
        res.summary = res.summary ? `${res.summary}${suffix}` : suffix;
      }
      try {
        await this.appendTaskEntry(task, startedAt, res, opts, info.conversationId);
      } catch (err) {
        mainLogger.warn('[scheduler] 写任务历史失败:', task.name, err);
      }
      await updateTaskRunState(task.id, undefined);
      // 被手动/窗口停止的运行不算「干净完成」，不链式触发 on_task_done 下游
      outcome = res.status === 'completed' && !info.stopRequested ? 'completed' : 'failed';
    } catch (err) {
      outcome = 'failed';
      mainLogger.warn('[scheduler] 任务执行异常:', task.name, err);
    } finally {
      this.running.delete(task.id);
      reportDone(task.id);
      this.emit('task_done', { taskId: task.id, outcome } satisfies TaskDoneEvent);
    }
  }
}

let taskRunnerInstance: TaskRunner | null = null;

export function getTaskRunner(): TaskRunner {
  if (!taskRunnerInstance) taskRunnerInstance = new TaskRunner();
  return taskRunnerInstance;
}

export type { TaskRunner };
