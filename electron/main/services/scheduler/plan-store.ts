import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getConfigDir } from '../settings-service.js';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';
import type { CustomScheduledTask, ScheduledTask, TaskRunState, Trigger } from './types.js';

interface PlansFileV2 {
  version: 2;
  tasks: ScheduledTask[];
}

function getPlansPath(): string {
  return path.join(getConfigDir(), 'plans.json');
}

type Loose = Record<string, unknown>;

function isLooseObject(v: unknown): v is Loose {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function copyTriggers(v: unknown): Trigger[] {
  if (!Array.isArray(v)) return [];
  const out: Trigger[] = [];
  for (const item of v) {
    if (!isLooseObject(item)) continue;
    if (item.type === 'on_plan_done') continue;
    out.push(structuredClone(item) as unknown as Trigger);
  }
  return out;
}

function migrateLegacyPlans(raw: unknown[]): ScheduledTask[] {
  const out: ScheduledTask[] = [];
  const seenBuiltinIds = new Set<string>();
  for (const item of raw) {
    if (!isLooseObject(item) || !Array.isArray(item.tasks)) continue;
    const planName = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '未命名计划';
    const enabled = item.enabled !== false;
    const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now();
    const updatedAt = typeof item.updatedAt === 'number' ? item.updatedAt : createdAt;
    const legacyTasks = item.tasks as unknown[];
    for (const lt of legacyTasks) {
      if (!isLooseObject(lt)) continue;
      const id = typeof lt.id === 'string' && lt.id ? lt.id : randomUUID();
      const workspaceId = typeof lt.workspaceId === 'string' ? lt.workspaceId : undefined;
      // 内置任务已全量下线，存量条目原样透传保留（消费侧由 isRetiredBuiltinTask 过滤隐藏）
      if (lt.kind === 'builtin') {
        if (seenBuiltinIds.has(String(lt.builtinId))) continue;
        seenBuiltinIds.add(String(lt.builtinId));
        const task = structuredClone(lt) as unknown as ScheduledTask;
        if (typeof task.id !== 'string' || !task.id) task.id = id;
        if (typeof task.name !== 'string' || !task.name) task.name = '未命名内置任务';
        task.enabled = enabled;
        task.triggers = copyTriggers(item.triggers);
        if (workspaceId !== undefined) task.workspaceId = workspaceId;
        task.createdAt = createdAt;
        task.updatedAt = updatedAt;
        out.push(task);
        continue;
      }
      if (lt.kind !== 'custom') continue;
      const displayName = typeof lt.name === 'string' && lt.name.trim() ? lt.name.trim() : '未命名任务';
      const task: CustomScheduledTask = {
        id,
        kind: 'custom',
        name: legacyTasks.length === 1 ? planName : `${planName}·${displayName}`,
        prompt: typeof lt.prompt === 'string' ? lt.prompt : '',
        enabled,
        triggers: copyTriggers(item.triggers),
        createdAt,
        updatedAt,
      };
      if (workspaceId !== undefined) task.workspaceId = workspaceId;
      if (isLooseObject(lt.modelSelection)) task.modelSelection = lt.modelSelection as unknown as CustomScheduledTask['modelSelection'];
      out.push(task);
    }
  }
  return out;
}

let readyPromise: Promise<void> | null = null;

/** 已下线内置任务（存量磁盘数据保留，仅消费侧隐藏）；内置任务类型已退役，运行时仍可能出现存量条目 */
export function isRetiredBuiltinTask(t: ScheduledTask): boolean {
  return (t as { kind?: string }).kind === 'builtin';
}

async function ensureStoreReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const raw = await safeJsonRead<unknown>(getPlansPath(), null);
      let tasks: ScheduledTask[];
      let needWrite: boolean;
      if (Array.isArray(raw)) {
        tasks = migrateLegacyPlans(raw);
        needWrite = true;
      } else if (isLooseObject(raw) && raw.version === 2 && Array.isArray(raw.tasks)) {
        tasks = raw.tasks as ScheduledTask[];
        needWrite = false;
      } else {
        tasks = [];
        needWrite = true;
      }
      if (needWrite) {
        await safeJsonWrite(getPlansPath(), { version: 2, tasks });
      }
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  await readyPromise;
}

export async function loadTasks(): Promise<ScheduledTask[]> {
  await ensureStoreReady();
  const data = await safeJsonRead<PlansFileV2 | null>(getPlansPath(), null);
  if (isLooseObject(data) && Array.isArray(data.tasks)) return data.tasks as ScheduledTask[];
  return [];
}

export async function saveTasks(tasks: ScheduledTask[]): Promise<void> {
  await safeJsonWrite(getPlansPath(), { version: 2, tasks });
}

let mutationQueue: Promise<unknown> = Promise.resolve();

function enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(fn, fn);
  mutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function mutateTask(taskId: string, fn: (task: ScheduledTask) => boolean): Promise<void> {
  await enqueueMutation(async () => {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const changed = fn(task);
    if (changed) await saveTasks(tasks);
  });
}

export async function updateTaskRunState(taskId: string, runState: TaskRunState | undefined): Promise<void> {
  await mutateTask(taskId, (task) => {
    if (runState === undefined) {
      if (task.runState === undefined) return false;
      delete task.runState;
      return true;
    }
    task.runState = runState;
    return true;
  });
}

export async function touchTriggerFired(taskId: string, triggerId: string, ts: number): Promise<void> {
  await mutateTask(taskId, (task) => {
    const trigger = task.triggers.find((t) => t.id === triggerId);
    if (!trigger) return false;
    trigger.lastFiredAt = ts;
    return true;
  });
}

export async function markOnceFired(taskId: string, triggerId: string): Promise<void> {
  await mutateTask(taskId, (task) => {
    const trigger = task.triggers.find((t) => t.id === triggerId);
    if (!trigger || trigger.type !== 'once' || trigger.fired) return false;
    trigger.fired = true;
    return true;
  });
}
