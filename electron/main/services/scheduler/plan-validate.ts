import { randomUUID } from 'node:crypto';
import type { CustomScheduledTask, ScheduledTask } from './types.js';
import { validateTrigger } from './time-rule-engine.js';

export const KNOWN_TOOL_PACKS: readonly string[] = [
  'article',
  'stock-quote',
  'stock-analysis',
  'stock-announcement',
  'stock-picking',
];

export function sanitizeToolPacksOverride(task: CustomScheduledTask): string[] | undefined {
  if (!Array.isArray(task.toolPacksOverride)) return undefined;
  return task.toolPacksOverride.filter((p) => typeof p === 'string' && KNOWN_TOOL_PACKS.includes(p));
}

export function assignTaskIds(task: ScheduledTask): ScheduledTask {
  const now = Date.now();
  return {
    ...task,
    id: task.id || randomUUID(),
    createdAt: task.createdAt || now,
    updatedAt: now,
    triggers: task.triggers.map((trigger) => (trigger.id ? trigger : { ...trigger, id: randomUUID() })),
  };
}

export function mergeFiredState(next: ScheduledTask, old: ScheduledTask | undefined): void {
  if (!old) return;
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

export interface TaskSaveContext {
  workspaceIds: Set<string>;
  /** 保存后语境的全量任务（被保存任务已替换为新版本），用于 on_task_done 引用校验与环检测 */
  allTasks: ScheduledTask[];
}

function detectTaskCycle(task: ScheduledTask, allTasks: ScheduledTask[]): string | null {
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const edgesOf = (id: string): string[] => {
    const t = byId.get(id);
    if (!t) return [];
    return t.triggers.filter((tr) => tr.type === 'on_task_done').map((tr) => tr.taskId);
  };
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycleFrom = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of edgesOf(id)) {
      if (hasCycleFrom(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const next of edgesOf(task.id)) {
    if (next === task.id || hasCycleFrom(next)) return '任务链触发不能构成循环';
  }
  return null;
}

export function validateTaskForSave(task: ScheduledTask, ctx: TaskSaveContext): string | null {
  // 入参来自前端 tipc，运行时可能是任意 JSON，kind 防御保留
  if (task.kind !== 'custom') return `未知任务类型 ${String((task as { kind?: unknown }).kind)}`;
  if (!task.name?.trim()) return '任务名称不能为空';
  if (!task.prompt?.trim()) return '任务提示词不能为空';
  if (!task.workspaceId) return '自定义任务必须指定工作区';
  if (task.toolPacksOverride !== undefined) {
    if (
      !Array.isArray(task.toolPacksOverride) ||
      task.toolPacksOverride.some((p) => typeof p !== 'string')
    ) {
      return '工具包覆盖配置无效';
    }
  }
  if (task.workspaceId !== undefined && !ctx.workspaceIds.has(task.workspaceId)) {
    return `工作区不存在 (${task.workspaceId})`;
  }
  if (!Array.isArray(task.triggers)) return '触发器列表无效';
  const allTaskIds = new Set(ctx.allTasks.map((t) => t.id));
  for (const [i, trigger] of task.triggers.entries()) {
    const err = validateTrigger(trigger);
    if (err) return `触发器 ${i + 1}: ${err}`;
    if (trigger.type === 'on_task_done' && !allTaskIds.has(trigger.taskId)) {
      return `触发器 ${i + 1}: 目标任务不存在`;
    }
  }
  return detectTaskCycle(task, ctx.allTasks);
}
