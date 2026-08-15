import { tipc } from '@egoist/tipc/main';
import { loadPlans, savePlans } from '../services/scheduler/plan-store.js';
import { queryHistory } from '../services/scheduler/run-history-store.js';
import { minNextDueAt } from '../services/scheduler/time-rule-engine.js';
import { getSchedulerService } from '../services/scheduler/scheduler-service.js';
import {
  assignPlanIds,
  mergeFiredState,
  validatePlanForSave,
} from '../services/scheduler/plan-validate.js';
import { getAll as getAllWorkspaces } from '../services/workspace-json-service.js';
import type { Plan } from '../services/scheduler/types.js';

const t = tipc.create();

export const schedulerRouter = {
  listPlans: t.procedure
    .action(async () => {
      try {
        const plans = await loadPlans();
        const now = Date.now();
        return { plans: plans.map((p) => ({ ...p, nextRunAt: minNextDueAt(p, now) ?? undefined })) };
      } catch (error) {
        console.error('[scheduler] listPlans 失败:', error);
        return { plans: [], error: String(error) };
      }
    }),

  savePlan: t.procedure
    .input<{ plan: Plan }>()
    .action(async ({ input }) => {
      try {
        const existing = await loadPlans();
        const prepared = assignPlanIds(input.plan);
        const isNew = !existing.some((p) => p.id === prepared.id);
        const allPlans = isNew
          ? [...existing, prepared]
          : existing.map((p) => (p.id === prepared.id ? prepared : p));
        const workspaces = await getAllWorkspaces().catch(() => []);
        const error = validatePlanForSave(prepared, {
          allPlans,
          workspaceIds: new Set(workspaces.map((w) => w.id)),
        });
        if (error) return { ok: false, error };
        if (!isNew) mergeFiredState(prepared, existing.find((p) => p.id === prepared.id));
        await savePlans(allPlans);
        return { ok: true };
      } catch (error) {
        console.error('[scheduler] savePlan 失败:', error);
        return { ok: false, error: String(error) };
      }
    }),

  deletePlan: t.procedure
    .input<{ planId: string }>()
    .action(async ({ input }) => {
      try {
        const plans = await loadPlans();
        const next = plans.filter((p) => p.id !== input.planId);
        if (next.length === plans.length) return { ok: false, error: '计划不存在' };
        await savePlans(next);
        return { ok: true };
      } catch (error) {
        console.error('[scheduler] deletePlan 失败:', error);
        return { ok: false, error: String(error) };
      }
    }),

  setPlanEnabled: t.procedure
    .input<{ planId: string; enabled: boolean }>()
    .action(async ({ input }) => {
      try {
        const plans = await loadPlans();
        const plan = plans.find((p) => p.id === input.planId);
        if (!plan) return { ok: false, error: '计划不存在' };
        if (plan.enabled !== input.enabled) {
          plan.enabled = input.enabled;
          plan.updatedAt = Date.now();
          await savePlans(plans);
        }
        return { ok: true };
      } catch (error) {
        console.error('[scheduler] setPlanEnabled 失败:', error);
        return { ok: false, error: String(error) };
      }
    }),

  runPlanNow: t.procedure
    .input<{ planId: string }>()
    .action(async ({ input }) => {
      try {
        return await getSchedulerService().runPlanManual(input.planId);
      } catch (error) {
        console.error('[scheduler] runPlanNow 失败:', error);
        return { started: false, error: String(error) };
      }
    }),

  listRunHistory: t.procedure
    .input<{ planId?: string; cursor?: number; limit?: number }>()
    .action(async ({ input }) => {
      try {
        return await queryHistory({ planId: input.planId, before: input.cursor, limit: input.limit });
      } catch (error) {
        console.error('[scheduler] listRunHistory 失败:', error);
        return { entries: [], error: String(error) };
      }
    }),

  getSchedulerActivity: t.procedure
    .action(async () => {
      try {
        return { activity: getSchedulerService().getActivity() };
      } catch (error) {
        console.error('[scheduler] getSchedulerActivity 失败:', error);
        return { activity: { running: [], lastTickAt: 0 }, error: String(error) };
      }
    }),
};
