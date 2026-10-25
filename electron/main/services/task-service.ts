/**
 * 任务 Service：task-store 之上的广播聚合入口
 *
 * - 所有写操作完成后广播 tasksChanged（覆盖 UI / Agent / 队列所有写入方），读操作直接透传
 * - 状态机与存储见 task-store.ts；存储定位用 workspaceId，广播与 planPath 解析用 workspacePath（调用方双持，如 tipc 反查后的 ws 对象、队列 QueuedWork）
 */
import * as taskStore from './task-store.js';
import * as conversationService from './conversation-service.js';
import { getNotificationCenterService } from './notification-center-service.js';
import { getSessionNotificationService } from './session-notification-service.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';

export type TaskStatus = taskStore.TaskStatus;
export type Task = taskStore.Task;
export type CreateTaskInput = taskStore.CreateTaskInput;
export type ReviewAction = taskStore.ReviewAction;
export type TaskDetail = taskStore.TaskDetail;
export type TaskGroups = taskStore.TaskGroups;
export type ExecProfile = taskStore.ExecProfile;

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

export async function createTask(
  workspaceId: string,
  workspacePath: string,
  input: taskStore.CreateTaskInput,
): Promise<taskStore.Task> {
  const task = await taskStore.createTask(workspaceId, workspacePath, input);
  broadcastTasksChanged(workspacePath);
  return task;
}

export const listTasks = taskStore.listTasks;
export const listTasksGrouped = taskStore.listTasksGrouped;
export const listDeletedTasks = taskStore.listDeletedTasks;
export const getTask = taskStore.getTask;
export const getTaskDetail = taskStore.getTaskDetail;

export async function reviewTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
  action: taskStore.ReviewAction,
): Promise<taskStore.Task> {
  const task = await taskStore.reviewTask(workspaceId, taskId, action);
  void getNotificationCenterService().markReadByTask(task.id);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function markTaskRunning(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
  execSessionId: string,
): Promise<taskStore.Task> {
  const task = await taskStore.markTaskRunning(workspaceId, taskId, execSessionId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function interruptTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
  reason: string,
): Promise<taskStore.Task> {
  const task = await taskStore.interruptTask(workspaceId, taskId, reason);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function reportTaskResult(
  workspaceId: string,
  workspacePath: string,
  execSessionId: string,
): Promise<taskStore.Task | null> {
  const task = await taskStore.reportTaskResult(workspaceId, execSessionId);
  if (task) {
    broadcastTasksChanged(workspacePath);
    void notifyTaskReview(task, workspaceId);
  }
  return task;
}

const REVIEW_NOTICE_BODY = '执行已完成，可打开任务面板审核';

async function notifyTaskReview(task: taskStore.Task, workspaceId: string): Promise<void> {
  try {
    const title = `任务待审核：${task.title}`;
    const service = getSessionNotificationService();
    service.notify({
      kind: 'complete',
      notificationId: `task-${task.id}-${task.status}-${task.updatedAt}`,
      conversationId: task.execSessionId ?? '',
      workspaceId,
      title,
      body: REVIEW_NOTICE_BODY,
      taskId: task.id,
    });
    service.playCue('complete');
    if (task.execSessionId) void conversationService.markUnreadIfNotFocused(task.execSessionId);
    await getNotificationCenterService().add({
      type: 'task',
      dedupeKey: `task:${task.id}:review`,
      title,
      summary: REVIEW_NOTICE_BODY,
      owner: { kind: 'system' },
      taskId: task.id,
      execSessionId: task.execSessionId,
      workspaceId,
      ownerLabel: '系统',
    });
  } catch {
    // 通知失败不影响申报主流程
  }
}

export async function rejectTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
  reason: string,
): Promise<taskStore.Task> {
  const task = await taskStore.rejectTask(workspaceId, taskId, reason);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function executeTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<taskStore.Task> {
  const task = await taskStore.executeTask(workspaceId, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function completeTaskManually(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<taskStore.Task> {
  const task = await taskStore.completeTaskManually(workspaceId, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function cancelTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<taskStore.Task> {
  const task = await taskStore.cancelTask(workspaceId, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function moveTaskToBacklog(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<taskStore.Task> {
  const task = await taskStore.moveTaskToBacklog(workspaceId, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function moveTaskToPlan(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<taskStore.Task> {
  const task = await taskStore.moveTaskToPlan(workspaceId, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function updateTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
  patch: taskStore.UpdateTaskPatch,
): Promise<taskStore.Task> {
  const task = await taskStore.updateTask(workspaceId, workspacePath, taskId, patch);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function deleteTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<taskStore.Task> {
  const task = await taskStore.softDeleteTask(workspaceId, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function restoreTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<taskStore.Task> {
  const task = await taskStore.restoreTask(workspaceId, taskId);
  broadcastTasksChanged(workspacePath);
  return task;
}

export async function purgeTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<boolean> {
  const purged = await taskStore.purgeTask(workspaceId, taskId);
  if (purged) broadcastTasksChanged(workspacePath);
  return purged;
}

/** 应用启动时恢复：遗留 running 无条件置 interrupted，交用户手动处置 */
export async function recoverInterruptedTasks(
  workspaceId: string,
  workspacePath: string,
): Promise<{ recovered: number; recoveredTasks: taskStore.Task[] }> {
  const result = await taskStore.recoverInterruptedTasks(workspaceId);
  if (result.recovered > 0) broadcastTasksChanged(workspacePath);
  return result;
}
