import path from 'node:path';
import { getConfigDir } from '../settings-service.js';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';
import type { ScheduledTask, TaskRunState } from './types.js';

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

let readyPromise: Promise<void> | null = null;

async function ensureStoreReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const raw = await safeJsonRead<unknown>(getPlansPath(), null);
      let tasks: ScheduledTask[];
      let needWrite: boolean;
      if (isLooseObject(raw) && raw.version === 2 && Array.isArray(raw.tasks)) {
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
