import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mainLogger } from '../../../agents/logger.js';
import type { RunHistoryEntry, ScheduledTask, SchedulerActivity } from '../types.js';
import { updateTaskRunState } from '../plan-store.js';
import { appendHistoryEntry } from '../run-history-store.js';
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
  taskId: string;
  taskName: string;
  startedAt: number;
  task: ScheduledTask;
  agentTaskId?: string;
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
      taskId: task.id,
      taskName: task.name,
      startedAt: Date.now(),
      task,
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
    if (info.task.kind === 'custom') {
      const agentTaskId = info.agentTaskId;
      if (!agentTaskId) return;
      void import('../../../agents/agent-manager.js')
        .then(({ getAgentManager }) => {
          getAgentManager().cancelTask(agentTaskId);
        })
        .catch((err) => mainLogger.warn('[scheduler] 取消自定义任务失败:', err));
      return;
    }
    switch (info.task.builtinId) {
      case 'group_digest':
        void import('../../memory/group-digest-trigger.js')
          .then((m) => m.cancelAllGroupDigest())
          .catch((err) => mainLogger.warn('[scheduler] 停止组卡提炼失败:', err));
        return;
      case 'review':
        void import('../../memory/review-trigger.js')
          .then((m) => m.cancelAllReview())
          .catch((err) => mainLogger.warn('[scheduler] 停止复盘失败:', err));
        return;
      case 'categorize':
        void import('../../memory/category-trigger.js')
          .then((m) => m.cancelAllCategorize())
          .catch((err) => mainLogger.warn('[scheduler] 停止智能分类失败:', err));
        return;
      case 'categorize_organize':
        void import('../../memory/category-trigger.js')
          .then((m) => m.cancelCategorizeOrganize())
          .catch((err) => mainLogger.warn('[scheduler] 停止分类整理失败:', err));
        return;
    }
  }

  getActivity(): SchedulerActivity {
    return {
      running: [...this.running.values()].map((r) => ({
        taskId: r.taskId,
        taskName: r.taskName,
        startedAt: r.startedAt,
      })),
      lastTickAt: 0,
    };
  }

  private async appendInterruptedEntry(task: ScheduledTask, opts: RunTaskOptions): Promise<void> {
    const entry: RunHistoryEntry = {
      id: randomUUID(),
      ts: Date.now(),
      planId: task.id,
      planName: task.name,
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
  ): Promise<void> {
    const entry: RunHistoryEntry = {
      id: randomUUID(),
      ts: Date.now(),
      planId: task.id,
      planName: task.name,
      kind: 'task',
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
      const startedAt = Date.now();
      await updateTaskRunState(task.id, { cursorStartedAt: startedAt });
      let res: TaskExecResult;
      try {
        res = await executeTask(task, {
          onAgentTaskId: (id) => {
            info.agentTaskId = id;
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
      await this.appendTaskEntry(task, startedAt, res, opts);
      await updateTaskRunState(task.id, undefined);
      // 被手动/窗口停止的运行不算「干净完成」，不链式触发 on_task_done 下游
      outcome = res.status === 'completed' && !info.stopRequested ? 'completed' : 'failed';
    } catch (err) {
      outcome = 'failed';
      mainLogger.warn('[scheduler] 任务执行异常:', task.name, err);
    } finally {
      this.running.delete(task.id);
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
