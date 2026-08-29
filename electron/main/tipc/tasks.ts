import { tipc } from '@egoist/tipc/main';
import {
  listTasksGrouped,
  getTaskDetail,
  reviewTask,
  type ReviewAction,
} from '../services/task-service.js';

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
};
