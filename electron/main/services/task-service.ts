/**
 * 任务 Service：task-store 之上的广播聚合入口
 *
 * - 所有写操作完成后广播 tasksChanged（覆盖 UI / Agent / 队列所有写入方），读操作直接透传
 * - 状态机与存储见 task-store.ts
 */
import * as taskStore from './task-store.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';

export type TaskStatus = taskStore.TaskStatus;
export type Task = taskStore.Task;
export type CreateTaskInput = taskStore.CreateTaskInput;
export type ReviewAction = taskStore.ReviewAction;
export type TaskDetail = taskStore.TaskDetail;
export type TaskGroups = taskStore.TaskGroups;

async function broadcastTasksChanged(workspacePath: string): Promise<void> {
  try {
    const [{ BrowserWindow }, { getRendererHandlers }] = await Promise.all([
      import('electron'),
      import('@egoist/tipc/main'),
    ]);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).tasksChanged.send({ workspacePath });
      } catch {
        // 窗口已销毁，忽略
      }
    }
  } catch {
    // 非 Electron 环境（冒烟脚本）无窗口可广播
  }
}

export async function createTask(workspacePath: string, input: taskStore.CreateTaskInput): Promise<taskStore.Task> {
  const task = await taskStore.createTask(workspacePath, input);
  broadcastTasksChanged(workspacePath);
  return task;
}

export const listTasks = taskStore.listTasks;
export const listTasksGrouped = taskStore.listTasksGrouped;
export const listDeletedTasks = taskStore.listDeletedTasks;
export const getTask = taskStore.getTask;
export const getTaskDetail = taskStore.getTaskDetail;

export async function reviewTask(workspacePath: string, taskId: string, action: taskStore.ReviewAction): Promise<taskStore.Task> {
  const task = await taskStore.reviewTask(workspacePath, taskId, action);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function markTaskRunning(workspacePath: string, taskId: string, execSessionId: string): Promise<taskStore.Task> {
  const task = await taskStore.markTaskRunning(workspacePath, taskId, execSessionId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function completeTask(workspacePath: string, taskId: string, result: string): Promise<taskStore.Task> {
  const task = await taskStore.completeTask(workspacePath, taskId, result);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function rejectTask(workspacePath: string, taskId: string, reason: string): Promise<taskStore.Task> {
  const task = await taskStore.rejectTask(workspacePath, taskId, reason);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function executeTask(workspacePath: string, taskId: string): Promise<taskStore.Task> {
  const task = await taskStore.executeTask(workspacePath, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function deleteTask(workspacePath: string, taskId: string): Promise<taskStore.Task> {
  const task = await taskStore.softDeleteTask(workspacePath, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function restoreTask(workspacePath: string, taskId: string): Promise<taskStore.Task> {
  const task = await taskStore.restoreTask(workspacePath, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function purgeTask(workspacePath: string, taskId: string): Promise<boolean> {
  const purged = await taskStore.purgeTask(workspacePath, taskId);
  if (purged) broadcastTasksChanged(workspacePath);
  return purged;
}

/** 应用启动时把遗留 running 置回 queued，返回恢复数 */
export async function recoverInterruptedTasks(workspacePath: string): Promise<number> {
  const recovered = await taskStore.recoverInterruptedTasks(workspacePath);
  if (recovered > 0) broadcastTasksChanged(workspacePath);
  return recovered;
}
