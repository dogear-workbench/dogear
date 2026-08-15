import { randomUUID } from 'node:crypto';
import { mainLogger } from '../../agents/logger.js';
import type { Plan, RunHistoryEntry, SchedulerActivity, Trigger } from './types.js';
import { loadPlans, markOnceFired, seedDefaultPlans, touchTriggerFired } from './plan-store.js';
import { appendHistoryEntry, cleanupHistory } from './run-history-store.js';
import {
  describeTrigger,
  detectMissed,
  nextDueAt,
  windowCloseAt,
  windowOpen,
  type MissedTrigger,
} from './time-rule-engine.js';
import { getPlanRunner, type PlanDoneEvent, type RunPlanOptions } from './runtime/plan-runner.js';

const TICK_MS = 60_000;
const WINDOW_CLOSE_TOLERANCE_MS = 2 * 60_000;

export interface MissedRecord extends MissedTrigger {
  planId: string;
  planName: string;
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
  private runner = getPlanRunner();

  async init(deps: SchedulerInitDeps = {}): Promise<void> {
    if (this.started) return;
    this.started = true;
    const bootAt = Date.now();
    const plans = await seedDefaultPlans();
    await cleanupHistory().catch((err) => mainLogger.warn('[scheduler] 清理运行历史失败:', err));
    const missed = this.collectMissed(plans, bootAt);
    if (missed.length > 0) {
      await this.recordMissed(missed);
      try {
        deps.onMissed?.(missed);
      } catch (err) {
        mainLogger.warn('[scheduler] onMissed 回调异常:', err);
      }
    }
    this.runner.on('plan_done', (e) => {
      void this.handlePlanDone(e).catch((err) => mainLogger.warn('[scheduler] 链式触发失败:', err));
    });
    await this.handleAppStart().catch((err) => mainLogger.warn('[scheduler] on_app_start 触发失败:', err));
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
      const plans = await loadPlans();
      for (const plan of plans) {
        if (!plan.enabled) continue;
        for (const trigger of plan.triggers) {
          await this.evaluateTrigger(plan, trigger, now).catch((err) =>
            mainLogger.warn(`[scheduler] 触发器求值失败: ${plan.name}/${trigger.type}:`, err),
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async handleAppStart(): Promise<void> {
    const plans = await loadPlans();
    for (const plan of plans) {
      if (!plan.enabled) continue;
      if (!plan.triggers.some((t) => t.type === 'on_app_start')) continue;
      await this.firePlan(plan.id, { triggerReason: 'condition', triggerDesc: '应用启动时' });
    }
  }

  async handleSessionClose(workspaceId?: string): Promise<void> {
    const plans = await loadPlans();
    const desc = workspaceId !== undefined ? `会话关闭时（工作区 ${workspaceId}）` : '会话关闭时';
    for (const plan of plans) {
      if (!plan.enabled) continue;
      if (!plan.triggers.some((t) => t.type === 'on_session_close')) continue;
      await this.firePlan(plan.id, { triggerReason: 'condition', triggerDesc: desc });
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
    this.runner.removeAllListeners('plan_done');
  }

  private async handlePlanDone(e: PlanDoneEvent): Promise<void> {
    if (e.outcome === 'stopped') return;
    const plans = await loadPlans();
    const sourceName = plans.find((p) => p.id === e.planId)?.name ?? e.planId;
    for (const plan of plans) {
      if (!plan.enabled || plan.id === e.planId) continue;
      if (!plan.triggers.some((t) => t.type === 'on_plan_done' && t.planId === e.planId)) continue;
      await this.firePlan(plan.id, { triggerReason: 'condition', triggerDesc: `计划「${sourceName}」完成后` });
    }
  }

  private collectMissed(plans: Plan[], bootAt: number): MissedRecord[] {
    const out: MissedRecord[] = [];
    for (const plan of plans) {
      if (!plan.enabled) continue;
      for (const m of detectMissed(plan.triggers, {}, bootAt)) {
        const trigger = plan.triggers.find((t) => t.id === m.triggerId);
        if (!trigger) continue;
        out.push({ ...m, planId: plan.id, planName: plan.name, trigger });
      }
    }
    return out;
  }

  private async recordMissed(missed: MissedRecord[]): Promise<void> {
    for (const m of missed) {
      const entry: RunHistoryEntry = {
        id: randomUUID(),
        ts: Date.now(),
        planId: m.planId,
        planName: m.planName,
        kind: 'missed',
        status: 'missed',
        triggerReason: 'time',
        triggerDesc: `错过未补跑: ${m.desc}`,
        startedAt: m.missedAt,
        endedAt: m.missedAt,
      };
      await appendHistoryEntry(entry).catch((err) => mainLogger.warn('[scheduler] 写 missed 历史失败:', err));
      if (m.trigger.type === 'once') {
        await markOnceFired(m.planId, m.triggerId);
      } else {
        await touchTriggerFired(m.planId, m.triggerId, m.missedAt);
      }
    }
  }

  private async evaluateTrigger(plan: Plan, trigger: Trigger, now: number): Promise<void> {
    switch (trigger.type) {
      case 'daily_at':
      case 'interval':
      case 'once': {
        const due = nextDueAt(trigger, now);
        if (due === null || due > now) return;
        if (trigger.lastFiredAt !== undefined && due <= trigger.lastFiredAt) return;
        await this.fireTimeTrigger(plan, trigger, due);
        return;
      }
      case 'window': {
        if (!windowOpen(trigger, now)) {
          this.clearWindowFiredKeys(plan.id, trigger.id);
          this.runner.requestStop(plan.id);
          return;
        }
        const key = `${plan.id}:${trigger.id}:${currentWindowStartTs(trigger.start, now)}`;
        if (this.windowFiredKeys.has(key)) return;
        this.windowFiredKeys.add(key);
        await this.firePlan(plan.id, { triggerReason: 'time', triggerDesc: describeTrigger(trigger) });
        return;
      }
      case 'on_window_close': {
        const closeAt = windowCloseAt(trigger, now - WINDOW_CLOSE_TOLERANCE_MS);
        if (closeAt === null || closeAt > now) return;
        if (trigger.lastFiredAt !== undefined && closeAt <= trigger.lastFiredAt) return;
        await touchTriggerFired(plan.id, trigger.id, closeAt);
        await this.firePlan(plan.id, { triggerReason: 'time', triggerDesc: describeTrigger(trigger) });
        return;
      }
      default:
        return;
    }
  }

  private async fireTimeTrigger(plan: Plan, trigger: Trigger, due: number): Promise<void> {
    if (trigger.type === 'once') {
      await markOnceFired(plan.id, trigger.id);
    } else {
      await touchTriggerFired(plan.id, trigger.id, due);
    }
    const started = await this.firePlan(plan.id, {
      triggerReason: 'time',
      triggerDesc: describeTrigger(trigger),
    });
    if (!started) {
      mainLogger.info(`[scheduler] 计划运行中，时间触发被忽略: ${plan.name} (${describeTrigger(trigger)})`);
    }
  }

  private async firePlan(planId: string, opts: RunPlanOptions): Promise<boolean> {
    const plans = await loadPlans();
    const plan = plans.find((p) => p.id === planId);
    if (!plan) {
      mainLogger.warn(`[scheduler] 计划已删除，跳过触发: ${planId}`);
      return false;
    }
    if (!plan.enabled) {
      mainLogger.info(`[scheduler] 计划已禁用，跳过触发: ${plan.name}`);
      return false;
    }
    return this.runner.runPlan(plan, opts).started;
  }

  private clearWindowFiredKeys(planId: string, triggerId: string): void {
    const prefix = `${planId}:${triggerId}:`;
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
