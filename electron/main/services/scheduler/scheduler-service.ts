import { randomUUID } from 'node:crypto';
import { mainLogger } from '../../agents/logger.js';
import type { RunHistoryEntry, ScheduledTask, SchedulerActivity, Trigger } from './types.js';
import { loadTasks, markOnceFired, touchTriggerFired } from './plan-store.js';
import { appendHistoryEntry, cleanupHistory } from './run-history-store.js';
import {
  describeTrigger,
  detectMissed,
  nextDueAt,
  windowCloseAt,
  windowOpen,
  type MissedTrigger,
} from './time-rule-engine.js';
import { getTaskRunner, type RunTaskOptions, type TaskDoneEvent } from './runtime/plan-runner.js';

const TICK_MS = 60_000;
const WINDOW_CLOSE_TOLERANCE_MS = 2 * 60_000;

export interface MissedRecord extends MissedTrigger {
  taskId: string;
  taskName: string;
  trigger: Trigger;
}

export interface SchedulerInitDeps {
  onMissed?: (entries: MissedRecord[]) => void;
}

function currentWindowStartTs(start: string, now: number): number {
  const d = new Date(now);
  const [h, m] = start.split(':').map(Number);
  const startMin = h * 60 + m;
  const nowMin = d.getHours() * 60 + d.getMinutes();
  d.setHours(h, m, 0, 0);
  if (nowMin < startMin) d.setDate(d.getDate() - 1);
  return d.getTime();
}

class SchedulerService {
  private tickTimer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private ticking = false;
  private started = false;
  private windowFiredKeys = new Set<string>();
  private runner = getTaskRunner();

  async init(deps: SchedulerInitDeps = {}): Promise<void> {
    if (this.started) return;
    this.started = true;
    const bootAt = Date.now();
    const tasks = await loadTasks();
    await cleanupHistory().catch((err) => mainLogger.warn('[scheduler] 清理运行历史失败:', err));
    const missed = this.collectMissed(tasks, bootAt);
    if (missed.length > 0) {
      await this.recordMissed(missed);
      try {
        deps.onMissed?.(missed);
      } catch (err) {
        mainLogger.warn('[scheduler] onMissed 回调异常:', err);
      }
    }
    await this.handleAppStart().catch((err) => mainLogger.warn('[scheduler] on_app_start 触发失败:', err));
    this.runner.on('task_done', (event: TaskDoneEvent) => {
      if (event.outcome !== 'completed') return;
      void this.fireTaskDoneDownstream(event.taskId).catch((err) =>
        mainLogger.warn('[scheduler] on_task_done 触发下游失败:', err),
      );
    });
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => {
      void this.tick().catch((err) => mainLogger.warn('[scheduler] tick 异常:', err));
    }, TICK_MS);
    this.tickTimer.unref();
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      this.lastTickAt = now;
      const tasks = await loadTasks();
      for (const task of tasks) {
        if (!task.enabled) continue;
        for (const trigger of task.triggers) {
          await this.evaluateTrigger(task, trigger, now).catch((err) =>
            mainLogger.warn(`[scheduler] 触发器求值失败: ${task.name}/${trigger.type}:`, err),
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async handleAppStart(): Promise<void> {
    const tasks = await loadTasks();
    for (const task of tasks) {
      if (!task.enabled) continue;
      if (!task.triggers.some((t) => t.type === 'on_app_start')) continue;
      await this.fireTask(task.id, { triggerReason: 'condition', triggerDesc: '应用启动时' });
    }
  }

  async handleSessionClose(workspaceId?: string): Promise<void> {
    const tasks = await loadTasks();
    const desc = workspaceId !== undefined ? `会话关闭时（工作区 ${workspaceId}）` : '会话关闭时';
    for (const task of tasks) {
      if (!task.enabled) continue;
      if (!task.triggers.some((t) => t.type === 'on_session_close')) continue;
      await this.fireTask(task.id, { triggerReason: 'condition', triggerDesc: desc });
    }
  }

  async runTaskManual(taskId: string): Promise<{ started: boolean }> {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      mainLogger.warn(`[scheduler] 手动运行失败，任务不存在: ${taskId}`);
      return { started: false };
    }
    return this.runner.runTask(task, { triggerReason: 'manual', triggerDesc: '手动运行' });
  }

  stopTask(taskId: string): { ok: boolean; error?: string } {
    try {
      this.runner.requestStop(taskId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async fireTaskDoneDownstream(upstreamId: string): Promise<void> {
    const tasks = await loadTasks();
    const upstream = tasks.find((t) => t.id === upstreamId);
    if (!upstream) {
      mainLogger.info(`[scheduler] on_task_done 上游任务已删除，跳过: ${upstreamId}`);
      return;
    }
    for (const task of tasks) {
      if (task.id === upstreamId || !task.enabled) continue;
      const hit = task.triggers.some((t) => t.type === 'on_task_done' && t.taskId === upstreamId);
      if (!hit) continue;
      await this.fireTask(task.id, {
        triggerReason: 'condition',
        triggerDesc: `任务「${upstream.name}」完成后`,
      });
    }
  }

  getActivity(): SchedulerActivity {
    const activity = this.runner.getActivity();
    return { ...activity, lastTickAt: this.lastTickAt };
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private collectMissed(tasks: ScheduledTask[], bootAt: number): MissedRecord[] {
    const out: MissedRecord[] = [];
    for (const task of tasks) {
      if (!task.enabled) continue;
      for (const m of detectMissed(task.triggers, {}, bootAt)) {
        const trigger = task.triggers.find((t) => t.id === m.triggerId);
        if (!trigger) continue;
        out.push({ ...m, taskId: task.id, taskName: task.name, trigger });
      }
    }
    return out;
  }

  private async recordMissed(missed: MissedRecord[]): Promise<void> {
    for (const m of missed) {
      const entry: RunHistoryEntry = {
        id: randomUUID(),
        ts: Date.now(),
        planId: m.taskId,
        planName: m.taskName,
        kind: 'missed',
        status: 'missed',
        triggerReason: 'time',
        triggerDesc: `错过未补跑: ${m.desc}`,
        startedAt: m.missedAt,
        endedAt: m.missedAt,
      };
      await appendHistoryEntry(entry).catch((err) => mainLogger.warn('[scheduler] 写 missed 历史失败:', err));
      if (m.trigger.type === 'once') {
        await markOnceFired(m.taskId, m.triggerId);
      } else {
        await touchTriggerFired(m.taskId, m.triggerId, m.missedAt);
      }
    }
  }

  private async evaluateTrigger(task: ScheduledTask, trigger: Trigger, now: number): Promise<void> {
    switch (trigger.type) {
      case 'daily_at':
      case 'interval':
      case 'once': {
        const due = nextDueAt(trigger, now);
        if (due === null || due > now) return;
        if (trigger.lastFiredAt !== undefined && due <= trigger.lastFiredAt) return;
        await this.fireTimeTrigger(task, trigger, due);
        return;
      }
      case 'window': {
        if (!windowOpen(trigger, now)) {
          this.clearWindowFiredKeys(task.id, trigger.id);
          this.runner.requestStop(task.id, trigger.id);
          return;
        }
        const key = `${task.id}:${trigger.id}:${currentWindowStartTs(trigger.start, now)}`;
        if (this.windowFiredKeys.has(key)) return;
        this.windowFiredKeys.add(key);
        await this.fireTask(task.id, {
          triggerReason: 'time',
          triggerDesc: describeTrigger(trigger),
          triggerId: trigger.id,
        });
        return;
      }
      case 'on_window_close': {
        const closeAt = windowCloseAt(trigger, now - WINDOW_CLOSE_TOLERANCE_MS);
        if (closeAt === null || closeAt > now) return;
        if (trigger.lastFiredAt !== undefined && closeAt <= trigger.lastFiredAt) return;
        await touchTriggerFired(task.id, trigger.id, closeAt);
        await this.fireTask(task.id, {
          triggerReason: 'time',
          triggerDesc: describeTrigger(trigger),
          triggerId: trigger.id,
        });
        return;
      }
      default:
        return;
    }
  }

  private async fireTimeTrigger(task: ScheduledTask, trigger: Trigger, due: number): Promise<void> {
    if (trigger.type === 'once') {
      await markOnceFired(task.id, trigger.id);
    } else {
      await touchTriggerFired(task.id, trigger.id, due);
    }
    const started = await this.fireTask(task.id, {
      triggerReason: 'time',
      triggerDesc: describeTrigger(trigger),
      triggerId: trigger.id,
    });
    if (!started) {
      mainLogger.info(`[scheduler] 任务运行中，时间触发被忽略: ${task.name} (${describeTrigger(trigger)})`);
    }
  }

  private async fireTask(taskId: string, opts: RunTaskOptions): Promise<boolean> {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      mainLogger.warn(`[scheduler] 任务已删除，跳过触发: ${taskId}`);
      return false;
    }
    if (!task.enabled) {
      mainLogger.info(`[scheduler] 任务已禁用，跳过触发: ${task.name}`);
      return false;
    }
    return this.runner.runTask(task, opts).started;
  }

  private clearWindowFiredKeys(taskId: string, triggerId: string): void {
    const prefix = `${taskId}:${triggerId}:`;
    for (const key of this.windowFiredKeys) {
      if (key.startsWith(prefix)) this.windowFiredKeys.delete(key);
    }
  }
}

let schedulerServiceInstance: SchedulerService | null = null;

export function getSchedulerService(): SchedulerService {
  if (!schedulerServiceInstance) schedulerServiceInstance = new SchedulerService();
  return schedulerServiceInstance;
}

export type { SchedulerService };
