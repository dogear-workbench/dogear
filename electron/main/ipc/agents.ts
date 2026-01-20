/**
 * Agent 相关 IPC 处理器
 * 处理 Agent 任务提交、取消和状态查询相关的 IPC 请求
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getAgentManager } from '../agents/agent-manager.js';
import { AgentTask, TaskType, ChatSessionPayload } from '../agents/task-types.js';
import { sendToDebugWindow } from '../index.js';

/**
 * 注册所有 Agent 相关的 IPC 处理器
 */
export function registerAgentHandlers() {
  const agentManager = getAgentManager();

  /**
   * 提交 Agent 任务
   * 支持流式和非流式两种模式
   */
  ipcMain.handle('agent:submitTask', async (event, task: AgentTask) => {
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

    // 如果是会话任务,注册会话消息回调
    if (task.type === TaskType.CHAT_SESSION && task.payload?.action === 'start') {
      agentManager.registerSessionCallback(taskId, (sessionId, message) => {
        // 发送会话消息到主窗口
        if (event.sender) {
          event.sender.send('agent:sessionMessage', {
            sessionId,
            message
          });
        }

        // 同时发送到调试窗口
        sendToDebugWindow('debug:agentMessage', {
          role: 'assistant',
          content: message,
          timestamp: Date.now()
        });
      });
    }

    return { taskId };
  });

  /**
   * 向会话发送消息
   */
  ipcMain.handle('agent:sendSessionMessage', async (event, sessionId: string, message: { role: string; content: string }) => {
    const task: AgentTask = {
      id: `msg-${Date.now()}`,
      type: TaskType.CHAT_SESSION,
      status: 'pending' as any,
      payload: {
        action: 'message',
        sessionId,
        message
      } as ChatSessionPayload,
      createdAt: Date.now()
    };

    // 提交任务
    const taskId = await agentManager.submitTask(task, (taskId, status, result, error) => {
      if (event.sender) {
        event.sender.send('agent:taskUpdate', {
          taskId,
          status,
          result,
          error
        });
      }
    });

    // 注册会话消息回调（如果还没有）
    if (!agentManager['sessionCallbacks'].has(sessionId)) {
      agentManager.registerSessionCallback(sessionId, (sessionId, message) => {
        // 发送会话消息到主窗口
        if (event.sender) {
          event.sender.send('agent:sessionMessage', {
            sessionId,
            message
          });
        }

        // 同时发送到调试窗口
        sendToDebugWindow('debug:agentMessage', {
          role: 'assistant',
          content: message,
          timestamp: Date.now()
        });
      });
    }

    return { taskId };
  });

  /**
   * 关闭会话
   */
  ipcMain.handle('agent:closeSession', async (_, sessionId: string) => {
    const task: AgentTask = {
      id: `close-${Date.now()}`,
      type: TaskType.CHAT_SESSION,
      status: 'pending' as any,
      payload: {
        action: 'close',
        sessionId
      } as ChatSessionPayload,
      createdAt: Date.now()
    };

    const taskId = await agentManager.submitTask(task);

    // 取消注册会话回调
    agentManager.unregisterSessionCallbacks(sessionId);

    return { taskId, success: true };
  });

  /**
   * 取消 Agent 任务
   */
  ipcMain.handle('agent:cancelTask', async (_, taskId: string) => {
    agentManager.cancelTask(taskId);
    return { success: true };
  });

  /**
   * 获取 Agent 管理器状态
   */
  ipcMain.handle('agent:getStatus', async () => {
    return agentManager.getStatus();
  });

  /**
   * 获取 Agent 管理器详细状态
   */
  ipcMain.handle('agent:getDetailedStatus', async () => {
    return agentManager.getDetailedStatus();
  });

  /**
   * 打开 Agent 监控窗口
   */
  ipcMain.handle('agent:openMonitorWindow', async () => {
    const { createAgentMonitorWindow } = await import('../index.js');
    createAgentMonitorWindow();
    return { success: true };
  });

  /**
   * 调试窗口专用:发送 Agent 消息
   */
  ipcMain.handle('debug:sendAgentMessage', async (_, prompt: string) => {
    // 创建聊天任务
    const task: AgentTask = {
      id: '', // 会在 submitTask 中生成
      type: TaskType.CHAT_SESSION,
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
