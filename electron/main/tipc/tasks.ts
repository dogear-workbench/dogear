import { tipc } from '@egoist/tipc/main';
import * as workspaceJsonService from '../services/workspace-json-service.js';
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
  moveTaskToBacklog,
  moveTaskToPlan,
  updateTask,
  type ReviewAction,
  type ExecProfile,
} from '../services/task-service.js';
import { getTaskQueue, interruptTaskExecSession } from '../services/task-queue.js';

const t = tipc.create();

/** 前端以 workspacePath 定位任务（历史传输格式），存储层吃 workspaceId——此处反查一次拿到双标识 */
async function resolveWorkspace(workspacePath: string): Promise<{ id: string; path: string }> {
  const ws = (await workspaceJsonService.getAll()).find((w) => w.path === workspacePath);
  if (!ws) throw new Error(`未注册的工作区路径: ${workspacePath}`);
  return { id: ws.id, path: ws.path };
}

export const tasksRouter = {
  listCollabTasks: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        return { groups: await listTasksGrouped(ws.id) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  listDeletedCollabTasks: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        return { tasks: await listDeletedTasks(ws.id) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  getCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        const detail = await getTaskDetail(ws.id, ws.path, input.taskId);
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
        const ws = await resolveWorkspace(input.workspacePath);
        return { task: await reviewTask(ws.id, ws.path, input.taskId, input.action) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  executeCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        const task = await executeTask(ws.id, ws.path, input.taskId);
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
        const ws = await resolveWorkspace(input.workspacePath);
        return { task: await completeTaskManually(ws.id, ws.path, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  moveCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string; to: 'backlog' | 'plan' }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        const task =
          input.to === 'backlog'
            ? await moveTaskToBacklog(ws.id, ws.path, input.taskId)
            : await moveTaskToPlan(ws.id, ws.path, input.taskId);
        return { task };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  updateCollabTaskExecProfile: t.procedure
    .input<{ workspacePath: string; taskId: string; execProfile: ExecProfile }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        return { task: await updateTask(ws.id, ws.path, input.taskId, { execProfile: input.execProfile }) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  cancelCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        const task = await getTask(ws.id, input.taskId);
        if (!task) return { error: `任务 ${input.taskId} 不存在` };
        if (!['queued', 'running'].includes(task.status)) {
          return { error: `仅排队中/执行中的任务可取消，当前状态为 ${task.status}` };
        }
        if (task.status === 'running' && task.execSessionId) {
          await interruptTaskExecSession(task.execSessionId);
        }
        return { task: await cancelTask(ws.id, ws.path, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  deleteCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        return { task: await deleteTask(ws.id, ws.path, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  restoreCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        return { task: await restoreTask(ws.id, ws.path, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  purgeCollabTask: t.procedure
    .input<{ workspacePath: string; taskId: string }>()
    .action(async ({ input }) => {
      try {
        const ws = await resolveWorkspace(input.workspacePath);
        return { success: await purgeTask(ws.id, ws.path, input.taskId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),
};
