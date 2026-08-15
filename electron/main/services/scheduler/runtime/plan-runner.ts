import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mainLogger } from '../../../agents/logger.js';
import type { Plan, PlanRunState, PlanTask, RunHistoryEntry, SchedulerActivity } from '../types.js';
import { updatePlanRunState } from '../plan-store.js';
import { appendHistoryEntry } from '../run-history-store.js';
import { executeTask, taskDisplayName, type TaskExecResult } from './task-executor.js';

export interface RunPlanOptions {
  triggerReason: 'time' | 'condition' | 'manual';
  triggerDesc?: string;
}

export type PlanRunOutcome = 'completed' | 'stopped' | 'failed';

export interface PlanDoneEvent {
  planId: string;
  outcome: PlanRunOutcome;
}

interface RunningInfo {
  planId: string;
  planName: string;
  startedAt: number;
  currentTaskId?: string;
  currentTaskName?: string;
  stopRequested: boolean;
}

class PlanRunner extends EventEmitter {
  private running = new Map<string, RunningInfo>();

  runPlan(plan: Plan, opts: RunPlanOptions): { started: boolean } {
    if (this.running.has(plan.id)) {
      mainLogger.warn(`[scheduler] 计划运行中，忽略重复触发: ${plan.name} (${plan.id})`);
      return { started: false };
    }
    const info: RunningInfo = {
      planId: plan.id,
      planName: plan.name,
      startedAt: Date.now(),
      stopRequested: false,
    };
    this.running.set(plan.id, info);
    void this.executePlan(plan, opts, info);
    return { started: true };
  }

  requestStop(planId: string): void {
    const info = this.running.get(planId);
    if (!info) return;
    info.stopRequested = true;
    mainLogger.info(`[scheduler] 已请求停止计划（当前任务跑完后停）: ${info.planName} (${planId})`);
  }

  getActivity(): SchedulerActivity {
    return {
      running: [...this.running.values()].map((r) => ({
        planId: r.planId,
        planName: r.planName,
        currentTaskId: r.currentTaskId,
        currentTaskName: r.currentTaskName,
        startedAt: r.startedAt,
      })),
      lastTickAt: 0,
    };
  }

  private async appendInterruptedEntry(
    plan: Plan,
    runState: PlanRunState,
    opts: RunPlanOptions,
  ): Promise<void> {
    const task = plan.tasks.find((t) => t.id === runState.cursor);
    const entry: RunHistoryEntry = {
      id: randomUUID(),
      ts: Date.now(),
      planId: plan.id,
      planName: plan.name,
      taskId: runState.cursor,
      taskName: task ? taskDisplayName(task) : undefined,
      kind: 'task',
      status: 'interrupted',
      triggerReason: opts.triggerReason,
      triggerDesc: opts.triggerDesc,
      startedAt: runState.cursorStartedAt,
      endedAt: Date.now(),
      summary: '上次运行被中断，续跑时补记',
    };
    await appendHistoryEntry(entry);
  }

  private async appendTaskEntry(
    plan: Plan,
    taskId: string,
    startedAt: number,
    res: TaskExecResult,
    opts: RunPlanOptions,
  ): Promise<void> {
    const task = plan.tasks.find((t) => t.id === taskId);
    const entry: RunHistoryEntry = {
      id: randomUUID(),
      ts: Date.now(),
      planId: plan.id,
      planName: plan.name,
      taskId,
      taskName: task ? taskDisplayName(task) : undefined,
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

  private resolveQueue(plan: Plan, taskMap: Map<string, PlanTask>): string[] {
    const runState = plan.runState;
    if (runState && Array.isArray(runState.pendingTasks)) {
      return runState.pendingTasks.filter((id) => {
        if (taskMap.has(id)) return true;
        mainLogger.warn(`[scheduler] 断点任务已不存在，跳过: ${id} (plan=${plan.name})`);
        return false;
      });
    }
    return plan.tasks.map((t) => t.id);
  }

  private async executePlan(plan: Plan, opts: RunPlanOptions, info: RunningInfo): Promise<void> {
    const taskMap = new Map(plan.tasks.map((t) => [t.id, t] as const));
    let outcome: PlanRunOutcome = 'completed';
    let anyFailed = false;
    let queue: string[] = [];
    try {
      const runState = plan.runState;
      if (runState?.cursor !== undefined && typeof runState.cursorStartedAt === 'number') {
        await this.appendInterruptedEntry(plan, runState, opts);
      }
      queue = this.resolveQueue(plan, taskMap);
      while (queue.length > 0 && !info.stopRequested) {
        const taskId = queue[0];
        const task = taskMap.get(taskId)!;
        info.currentTaskId = taskId;
        info.currentTaskName = taskDisplayName(task);
        const startedAt = Date.now();
        await updatePlanRunState(plan.id, {
          pendingTasks: [...queue],
          cursor: taskId,
          cursorStartedAt: startedAt,
        });
        let res: TaskExecResult;
        try {
          res = await executeTask(task);
        } catch (err) {
          res = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
        }
        if (res.status === 'failed') anyFailed = true;
        await this.appendTaskEntry(plan, taskId, startedAt, res, opts);
        queue = queue.slice(1);
        if (queue.length === 0) {
          await updatePlanRunState(plan.id, undefined);
        } else {
          await updatePlanRunState(plan.id, { pendingTasks: [...queue], cursor: queue[0] });
        }
      }
      if (queue.length === 0) {
        await updatePlanRunState(plan.id, undefined);
        outcome = anyFailed ? 'failed' : 'completed';
      } else {
        outcome = 'stopped';
        await updatePlanRunState(plan.id, { pendingTasks: [...queue] });
      }
    } catch (err) {
      outcome = 'failed';
      mainLogger.warn('[scheduler] 计划执行异常:', plan.name, err);
    } finally {
      this.running.delete(plan.id);
      this.emit('plan_done', { planId: plan.id, outcome } satisfies PlanDoneEvent);
    }
  }
}

let planRunnerInstance: PlanRunner | null = null;

export function getPlanRunner(): PlanRunner {
  if (!planRunnerInstance) planRunnerInstance = new PlanRunner();
  return planRunnerInstance;
}

export type { PlanRunner };
