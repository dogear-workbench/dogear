import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mainLogger } from '../../../agents/logger.js';
import type { RunHistoryEntry, ScheduledTask, SchedulerActivity } from '../types.js';
import { updateTaskRunState } from '../plan-store.js';
import { appendHistoryEntry } from '../run-history-store.js';
import { executeTask, type TaskExecResult } from './task-executor.js';

export interface RunTaskOptions {
  triggerReason: 'time' | 'condition' | 'manual';
  triggerDesc?: string;
}

export type TaskRunOutcome = 'completed' | 'failed';

export interface TaskDoneEvent {
  taskId: string;
  outcome: TaskRunOutcome;
}

interface RunningInfo {
  taskId: string;
  taskName: string;
  startedAt: number;
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
    };
    this.running.set(task.id, info);
    void this.executeSingleTask(task, opts, info);
    return { started: true };
  }

  requestStop(taskId: string): void {
    const info = this.running.get(taskId);
    if (!info) return;
    mainLogger.info(`[scheduler] 已请求停止任务（单任务模式下当前任务自然结束）: ${info.taskName} (${taskId})`);
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
        res = await executeTask(task);
      } catch (err) {
        res = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
      await this.appendTaskEntry(task, startedAt, res, opts);
      await updateTaskRunState(task.id, undefined);
      outcome = res.status === 'failed' ? 'failed' : 'completed';
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
