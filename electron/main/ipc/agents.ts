/**
 * Agent 相关 IPC 处理器
 * 处理 Agent 任务提交、取消和状态查询相关的 IPC 请求
 */

import { ipcMain } from 'electron';
import { getAgentManager } from '../agents/agent-manager.js';
import { AgentTask } from '../agents/task-types.js';

/**
 * 注册所有 Agent 相关的 IPC 处理器
 */
export function registerAgentHandlers() {
  /**
   * 提交 Agent 任务
   */
  ipcMain.handle('agent:submitTask', async (event, task: AgentTask) => {
    const agentManager = getAgentManager();

    // 提交任务并注册回调,通过 IPC 事件通知前端
    const taskId = await agentManager.submitTask(task, (taskId, status, result, error) => {
      // 发送任务更新事件到前端
      if (event.sender) {
        event.sender.send('agent:taskUpdate', {
          taskId,
          status,
          result,
          error
        });
      }
    });

    return { taskId };
  });

  /**
   * 取消 Agent 任务
   */
  ipcMain.handle('agent:cancelTask', async (_, taskId: string) => {
    const agentManager = getAgentManager();
    agentManager.cancelTask(taskId);
    return { success: true };
  });

  /**
   * 获取 Agent 管理器状态
   */
  ipcMain.handle('agent:getStatus', async () => {
    const agentManager = getAgentManager();
    return agentManager.getStatus();
  });
}
