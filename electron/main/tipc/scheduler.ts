import { tipc } from '@egoist/tipc/main';
import { loadTasks, saveTasks } from '../services/scheduler/plan-store.js';
import { queryHistory } from '../services/scheduler/run-history-store.js';
import { minNextDueAt } from '../services/scheduler/time-rule-engine.js';
import { getSchedulerService } from '../services/scheduler/scheduler-service.js';
import {
  assignTaskIds,
  mergeFiredState,
  sanitizeToolPacksOverride,
  validateTaskForSave,
} from '../services/scheduler/plan-validate.js';
import { getAll as getAllWorkspaces } from '../services/workspace-json-service.js';
import { getConfigDir } from '../services/settings-service.js';
import { BUILTIN_TASK_META } from '../services/scheduler/builtin-task-meta.js';
import type { BuiltinTaskId, ScheduledTask } from '../services/scheduler/types.js';

const t = tipc.create();

export const schedulerRouter = {
  listTasks: t.procedure
    .action(async () => {
      try {
        const tasks = await loadTasks();
        const now = Date.now();
        return { tasks: tasks.map((task) => ({ ...task, nextRunAt: minNextDueAt(task, now) ?? undefined })) };
      } catch (error) {
        console.error('[scheduler] listTasks 失败:', error);
        return { tasks: [], error: String(error) };
      }
    }),

  saveTask: t.procedure
    .input<{ task: ScheduledTask }>()
    .action(async ({ input }) => {
      try {
        const existing = await loadTasks();
        let prepared = assignTaskIds(input.task);
        if (prepared.kind === 'custom') {
          prepared = { ...prepared, toolPacksOverride: sanitizeToolPacksOverride(prepared) };
        }
        const isNew = !existing.some((t) => t.id === prepared.id);
        const allTasks = isNew
          ? [...existing, prepared]
          : existing.map((t) => (t.id === prepared.id ? prepared : t));
        const workspaces = await getAllWorkspaces().catch(() => []);
        const error = validateTaskForSave(prepared, {
          workspaceIds: new Set(workspaces.map((w) => w.id)),
        });
        if (error) return { ok: false, error };
        if (!isNew) mergeFiredState(prepared, existing.find((t) => t.id === prepared.id));
        await saveTasks(allTasks);
        return { ok: true };
      } catch (error) {
        console.error('[scheduler] saveTask 失败:', error);
        return { ok: false, error: String(error) };
      }
    }),

  deleteTask: t.procedure
    .input<{ taskId: string }>()
    .action(async ({ input }) => {
      try {
        const tasks = await loadTasks();
        const target = tasks.find((t) => t.id === input.taskId);
        if (!target) return { ok: false, error: '任务不存在' };
        if (target.kind === 'builtin') return { ok: false, error: '内置任务不能删除' };
        await saveTasks(tasks.filter((t) => t.id !== input.taskId));
        return { ok: true };
      } catch (error) {
        console.error('[scheduler] deleteTask 失败:', error);
        return { ok: false, error: String(error) };
      }
    }),

  setTaskEnabled: t.procedure
    .input<{ taskId: string; enabled: boolean }>()
    .action(async ({ input }) => {
      try {
        const tasks = await loadTasks();
        const task = tasks.find((t) => t.id === input.taskId);
        if (!task) return { ok: false, error: '任务不存在' };
        if (task.enabled !== input.enabled) {
          task.enabled = input.enabled;
          task.updatedAt = Date.now();
          await saveTasks(tasks);
        }
        return { ok: true };
      } catch (error) {
        console.error('[scheduler] setTaskEnabled 失败:', error);
        return { ok: false, error: String(error) };
      }
    }),

  runTaskNow: t.procedure
    .input<{ taskId: string }>()
    .action(async ({ input }) => {
      try {
        return await getSchedulerService().runTaskManual(input.taskId);
      } catch (error) {
        console.error('[scheduler] runTaskNow 失败:', error);
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

  getBuiltinTaskDetail: t.procedure
    .input<{ builtinId: string }>()
    .action(async ({ input }) => {
      try {
        const meta = BUILTIN_TASK_META[input.builtinId as BuiltinTaskId];
        if (!meta) return { prompt: '', tools: [], error: `未知内置任务: ${input.builtinId}` };
        const prompt = await meta.loadPrompt(getConfigDir());
        return { prompt, tools: meta.tools };
      } catch (error) {
        console.error('[scheduler] getBuiltinTaskDetail 失败:', error);
        return { prompt: '', tools: [], error: String(error) };
      }
    }),

  saveBuiltinPrompt: t.procedure
    .input<{ builtinId: string; prompt: string }>()
    .action(async ({ input }) => {
      try {
        const meta = BUILTIN_TASK_META[input.builtinId as BuiltinTaskId];
        if (!meta) return { ok: false, error: `未知内置任务: ${input.builtinId}` };
        if (!input.prompt.trim()) return { ok: false, error: '提示词不能为空' };
        await meta.savePrompt(getConfigDir(), input.prompt);
        return { ok: true };
      } catch (error) {
        console.error('[scheduler] saveBuiltinPrompt 失败:', error);
        return { ok: false, error: String(error) };
      }
    }),

  resetBuiltinPrompt: t.procedure
    .input<{ builtinId: string }>()
    .action(async ({ input }) => {
      try {
        const meta = BUILTIN_TASK_META[input.builtinId as BuiltinTaskId];
        if (!meta) return { ok: false, prompt: '', error: `未知内置任务: ${input.builtinId}` };
        const prompt = await meta.defaultPrompt(getConfigDir());
        await meta.savePrompt(getConfigDir(), prompt);
        return { ok: true, prompt };
      } catch (error) {
        console.error('[scheduler] resetBuiltinPrompt 失败:', error);
        return { ok: false, prompt: '', error: String(error) };
      }
    }),
};
