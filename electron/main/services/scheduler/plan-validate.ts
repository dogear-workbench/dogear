import { randomUUID } from 'node:crypto';
import type { BuiltinTaskId, Plan, PlanTask, Trigger } from './types.js';
import { validateTrigger } from './time-rule-engine.js';

const BUILTIN_TASK_IDS: readonly BuiltinTaskId[] = ['group_digest', 'review', 'categorize', 'categorize_organize'];

export function assignPlanIds(plan: Plan): Plan {
  const now = Date.now();
  return {
    ...plan,
    id: plan.id || randomUUID(),
    createdAt: plan.createdAt || now,
    updatedAt: now,
    tasks: plan.tasks.map((task) => ({ ...task, id: task.id || randomUUID() })),
    triggers: plan.triggers.map((trigger) => (trigger.id ? trigger : { ...trigger, id: randomUUID() })),
  };
}

export function mergeFiredState(next: Plan, old: Plan | undefined): void {
  if (!old) return;
  if (next.runState === undefined && old.runState !== undefined) next.runState = old.runState;
  for (const trigger of next.triggers) {
    const prev = old.triggers.find((t) => t.id === trigger.id);
    if (!prev) continue;
    if (prev.lastFiredAt !== undefined && trigger.lastFiredAt === undefined) {
      trigger.lastFiredAt = prev.lastFiredAt;
    }
    if (trigger.type === 'once' && prev.type === 'once' && prev.fired && trigger.fired === undefined) {
      trigger.fired = true;
    }
  }
}

export function detectPlanCycle(plans: Plan[]): string | null {
  const edges = new Map<string, string[]>();
  for (const plan of plans) {
    edges.set(
      plan.id,
      plan.triggers.flatMap((t) => (t.type === 'on_plan_done' ? [t.planId] : [])),
    );
  }
  const state = new Map<string, number>();
  const path: string[] = [];

  function dfs(id: string): string | null {
    state.set(id, 1);
    path.push(id);
    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) continue;
      const s = state.get(next) ?? 0;
      if (s === 1) {
        const cycle = [...path.slice(path.indexOf(next)), next];
        return `计划依赖成环: ${cycle.join(' → ')}`;
      }
      if (s === 0) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    path.pop();
    state.set(id, 2);
    return null;
  }

  for (const id of edges.keys()) {
    if ((state.get(id) ?? 0) !== 0) continue;
    const found = dfs(id);
    if (found) return found;
  }
  return null;
}

export interface PlanSaveContext {
  allPlans: Plan[];
  workspaceIds: Set<string>;
}

function validateTask(task: PlanTask, workspaceIds: Set<string>, index: number): string | null {
  const label = `任务 ${index + 1}`;
  if (task.kind === 'builtin') {
    if (!BUILTIN_TASK_IDS.includes(task.builtinId)) return `${label}: 未知内置任务 ${String(task.builtinId)}`;
  } else if (task.kind === 'custom') {
    if (!task.name?.trim()) return `${label}: 自定义任务名称不能为空`;
    if (!task.prompt?.trim()) return `${label}: 自定义任务 prompt 不能为空`;
  } else {
    return `${label}: 未知任务类型 ${String((task as PlanTask).kind)}`;
  }
  if (task.workspaceId !== undefined && !workspaceIds.has(task.workspaceId)) {
    return `${label}: 工作区不存在 (${task.workspaceId})`;
  }
  return null;
}

function validateTriggerRefs(triggers: Trigger[], planIds: Set<string>): string | null {
  for (const trigger of triggers) {
    if (trigger.type !== 'on_plan_done') continue;
    if (!planIds.has(trigger.planId)) return `触发器依赖的计划不存在: ${trigger.planId}`;
  }
  return null;
}

export function validatePlanForSave(plan: Plan, ctx: PlanSaveContext): string | null {
  if (!plan.name?.trim()) return '计划名称不能为空';
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) return '至少需要一个任务';
  if (!Array.isArray(plan.triggers)) return '触发器列表无效';
  for (const [i, task] of plan.tasks.entries()) {
    const err = validateTask(task, ctx.workspaceIds, i);
    if (err) return err;
  }
  for (const [i, trigger] of plan.triggers.entries()) {
    const err = validateTrigger(trigger);
    if (err) return `触发器 ${i + 1}: ${err}`;
  }
  const refErr = validateTriggerRefs(plan.triggers, new Set(ctx.allPlans.map((p) => p.id)));
  if (refErr) return refErr;
  return detectPlanCycle(ctx.allPlans);
}
