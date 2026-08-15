import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getConfigDir } from '../settings-service.js';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';
import type { Plan, PlanRunState } from './types.js';

function getPlansPath(): string {
  return path.join(getConfigDir(), 'plans.json');
}

export async function loadPlans(): Promise<Plan[]> {
  const data = await safeJsonRead<Plan[] | null>(getPlansPath(), null);
  return Array.isArray(data) ? data : [];
}

export async function savePlans(plans: Plan[]): Promise<void> {
  await safeJsonWrite(getPlansPath(), plans);
}

export function createDefaultNightPlan(): Plan {
  const now = Date.now();
  return {
    id: randomUUID(),
    name: '夜间维护',
    enabled: true,
    tasks: [
      { id: randomUUID(), kind: 'builtin', builtinId: 'group_digest' },
      { id: randomUUID(), kind: 'builtin', builtinId: 'review' },
    ],
    triggers: [
      { id: randomUUID(), type: 'window', start: '03:00', end: '05:00' },
      { id: randomUUID(), type: 'on_app_start' },
      { id: randomUUID(), type: 'on_session_close' },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedDefaultPlans(): Promise<Plan[]> {
  const plansPath = getPlansPath();
  let exists = true;
  try {
    await fs.access(plansPath);
  } catch {
    exists = false;
  }
  if (exists) return loadPlans();
  const seeded = [createDefaultNightPlan()];
  await safeJsonWrite(plansPath, seeded);
  return seeded;
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

async function mutatePlan(planId: string, fn: (plan: Plan) => boolean): Promise<void> {
  await enqueueMutation(async () => {
    const plans = await loadPlans();
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const changed = fn(plan);
    if (changed) await savePlans(plans);
  });
}

export async function updatePlanRunState(planId: string, runState: PlanRunState | undefined): Promise<void> {
  await mutatePlan(planId, (plan) => {
    if (runState === undefined) {
      if (plan.runState === undefined) return false;
      delete plan.runState;
      return true;
    }
    plan.runState = runState;
    return true;
  });
}

export async function touchTriggerFired(planId: string, triggerId: string, ts: number): Promise<void> {
  await mutatePlan(planId, (plan) => {
    const trigger = plan.triggers.find((t) => t.id === triggerId);
    if (!trigger) return false;
    trigger.lastFiredAt = ts;
    return true;
  });
}

export async function markOnceFired(planId: string, triggerId: string): Promise<void> {
  await mutatePlan(planId, (plan) => {
    const trigger = plan.triggers.find((t) => t.id === triggerId);
    if (!trigger || trigger.type !== 'once' || trigger.fired) return false;
    trigger.fired = true;
    return true;
  });
}
