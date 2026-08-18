import { randomUUID } from 'node:crypto';
import type { CustomScheduledTask, ScheduledTask } from './types.js';
import { validateTrigger } from './time-rule-engine.js';
import { BUILTIN_LABELS, BUILTIN_TASK_IDS } from './builtin-task-meta.js';

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
}

export function validateTaskForSave(task: ScheduledTask, ctx: TaskSaveContext): string | null {
  if (task.kind === 'builtin') {
    if (typeof task.builtinId !== 'string' || !BUILTIN_TASK_IDS.includes(task.builtinId)) {
      return `未知内置任务 ${String(task.builtinId)}`;
    }
    if (task.name !== BUILTIN_LABELS[task.builtinId]) return '内置任务名称不能修改';
  } else if (task.kind === 'custom') {
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
  } else {
    return `未知任务类型 ${String((task as ScheduledTask).kind)}`;
  }
  if (task.workspaceId !== undefined && !ctx.workspaceIds.has(task.workspaceId)) {
    return `工作区不存在 (${task.workspaceId})`;
  }
  if (!Array.isArray(task.triggers)) return '触发器列表无效';
  for (const [i, trigger] of task.triggers.entries()) {
    const err = validateTrigger(trigger);
    if (err) return `触发器 ${i + 1}: ${err}`;
  }
  return null;
}
