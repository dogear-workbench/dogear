import { tipc } from '@egoist/tipc/main';
import {
  listTasksGrouped,
  listDeletedTasks,
  getTaskDetail,
  getTask,
  reviewTask,
  executeTask,
  completeTaskManually,
  cancelTask,
  deleteTask,
  restoreTask,
  purgeTask,
  type ReviewAction,
} from '../services/task-service.js';
import { getTaskQueue, interruptTaskExecSession } from '../services/task-queue.js';

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

  listDeletedCollabTasks: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        return { tasks: await listDeletedTasks(input.workspacePath) };
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

  completeCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        return { task: await completeTaskManually(input.workspacePath, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  cancelCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const task = await getTask(input.workspacePath, input.taskId);
        if (!task) return { error: `任务 ${input.taskId} 不存在` };
        if (!['queued', 'running'].includes(task.status)) {
          return { error: `仅排队中/执行中的任务可取消，当前状态为 ${task.status}` };
        }
        if (task.status === 'running' && task.execSessionId) {
          await interruptTaskExecSession(task.execSessionId);
        }
        return { task: await cancelTask(input.workspacePath, input.taskId) };
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
