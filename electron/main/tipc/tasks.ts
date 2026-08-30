import { tipc } from '@egoist/tipc/main';
import {
  listTasksGrouped,
  getTaskDetail,
  reviewTask,
  executeTask,
  deleteTask,
  restoreTask,
  purgeTask,
  type ReviewAction,
} from '../services/task-service.js';
import { getTaskQueue } from '../services/task-queue.js';

const t = tipc.create();

export const tasksRouter = {
  listCollabTasks: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        return { groups: await listTasksGrouped(input.workspacePath) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  getCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const detail = await getTaskDetail(input.workspacePath, input.taskId);
        if (!detail) return { error: `任务 ${input.taskId} 不存在` };
        return { detail };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  reviewCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string; action: ReviewAction }>()
    .action(async ({ input }) => {
      try {
        return { task: await reviewTask(input.workspacePath, input.taskId, input.action) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  executeCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const task = await executeTask(input.workspacePath, input.taskId);
        getTaskQueue().kick();
        return { task };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  deleteCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        return { task: await deleteTask(input.workspacePath, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  restoreCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        return { task: await restoreTask(input.workspacePath, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  purgeCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        return { success: await purgeTask(input.workspacePath, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),
};
