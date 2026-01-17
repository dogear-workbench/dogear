/**
 * Agent 相关 IPC 处理器
 * 处理 Agent 任务提交、取消和状态查询相关的 IPC 请求
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getAgentManager } from '../agents/agent-manager.js';
import { AgentTask, TaskType } from '../agents/task-types.js';
import { sendToDebugWindow } from '../index.js';

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
      // 发送任务更新事件到主窗口
      if (event.sender) {
        event.sender.send('agent:taskUpdate', {
          taskId,
          status,
          result,
          error
        });
      }

      // 同时发送到调试窗口
      sendToDebugWindow('debug:taskUpdate', {
        taskId,
        status,
        result,
        error
      });

      // 如果有消息结果,也发送到调试窗口
      if (result?.message) {
        sendToDebugWindow('debug:agentMessage', {
          role: 'assistant',
          content: result.message,
          timestamp: Date.now()
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

  /**
   * 调试窗口专用:发送 Agent 消息
   */
  ipcMain.handle('debug:sendAgentMessage', async (_, prompt: string) => {
    const agentManager = getAgentManager();

    // 创建聊天任务
    const task: AgentTask = {
      id: '', // 会在 submitTask 中生成
      type: TaskType.CHAT,
      status: 'pending' as any,
      payload: {
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      createdAt: Date.now()
    };

    // 提交任务
    const taskId = await agentManager.submitTask(task, (taskId, status, result, error) => {
      // 发送到调试窗口
      sendToDebugWindow('debug:taskUpdate', {
        taskId,
        status,
        result,
        error
      });

      // 发送消息到调试窗口
      if (result?.message) {
        sendToDebugWindow('debug:agentMessage', {
          role: 'assistant',
          content: result.message,
          timestamp: Date.now()
        });
      }

      // 发送错误消息
      if (error) {
        sendToDebugWindow('debug:agentMessage', {
          role: 'system',
          content: `错误: ${error}`,
          timestamp: Date.now()
        });
      }
    });

    return { taskId };
  });
}
