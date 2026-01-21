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

    // 会话消息回调已在启动会话时注册，这里不需要重复注册

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

  // ==================== v2 新增：书籍分析相关 IPC ====================

  /**
   * 分析书籍 (v2)
   * 启动 Agent 分析书籍内容并保存结果到文件系统
   */
  ipcMain.handle('book:analyze', async (event, bookId: string) => {
    try {
      const task: AgentTask = {
        id: '', // 会在 submitTask 中生成
        type: TaskType.ANALYZE_BOOK,
        status: 'pending' as any,
        payload: { bookId },
        createdAt: Date.now()
      };

      const taskId = await agentManager.submitTask(task, (taskId, status, result, error) => {
        // 发送任务更新事件
        if (event.sender) {
          event.sender.send('book:analysisUpdate', {
            bookId,
            taskId,
            status,
            result,
            error
          });
        }
      });

      return { taskId };

    } catch (error) {
      console.error('启动书籍分析失败:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 获取书籍分析状态 (v2)
   */
  ipcMain.handle('book:getAnalysisStatus', async (_, bookId: string) => {
    try {
      const { loadAnalysisStatus } = await import('../services/workspace-service.js');
      const status = await loadAnalysisStatus(bookId);
      const { loadAnalysisResult } = await import('../services/workspace-service.js');
      const result = await loadAnalysisResult(bookId);

      return {
        status: status?.analysisStatus || 'none',
        result: result || null
      };
    } catch (error) {
      console.error('获取分析状态失败:', error);
      return { status: 'none', result: null, error: String(error) };
    }
  });

  /**
   * 获取章节分析列表 (v2)
   */
  ipcMain.handle('book:getChapterAnalyses', async (_, bookId: string) => {
    try {
      const { loadChapterAnalyses } = await import('../services/workspace-service.js');
      const analyses = await loadChapterAnalyses(bookId);
      return { analyses };
    } catch (error) {
      console.error('获取章节分析失败:', error);
      return { analyses: [], error: String(error) };
    }
  });

  /**
   * 基于分析结果的问答 (v2)
   * 用户可以针对已分析的内容提问
   */
  ipcMain.handle('book:chatWithAnalysis', async (event, bookId: string, message: string) => {
    try {
      // 创建聊天会话任务
      const task: AgentTask = {
        id: '',
        type: TaskType.CHAT_SESSION,
        status: 'pending' as any,
        payload: {
          action: 'start',
          context: { bookId }
        } as ChatSessionPayload,
        createdAt: Date.now()
      };

      // 注册会话消息回调
      const sessionId = await agentManager.submitTask(task, (taskId, status, result, error) => {
        if (event.sender) {
          event.sender.send('agent:taskUpdate', {
            taskId,
            status,
            result,
            error
          });
        }
      });

      // 注册会话消息回调（用于后续消息）
      agentManager.registerSessionCallback(sessionId, async (sid, msg) => {
        if (event.sender) {
          event.sender.send('book:chatMessage', {
            bookId,
            sessionId: sid,
            message: msg
          });
        }
      });

      // 发送用户的第一个消息
      const chatTask: AgentTask = {
        id: `chat-${Date.now()}`,
        type: TaskType.CHAT_SESSION,
        status: 'pending' as any,
        payload: {
          action: 'message',
          sessionId,
          message: { role: 'user', content: message }
        } as ChatSessionPayload,
        createdAt: Date.now()
      };

      await agentManager.submitTask(chatTask);

      return { sessionId };

    } catch (error) {
      console.error('启动分析对话失败:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 获取书籍文件路径 (v2)
   */
  ipcMain.handle('book:getFilePath', async (_, bookId: string) => {
    try {
      const { getBookFilePath } = await import('../services/workspace-service.js');
      const filePath = await getBookFilePath(bookId);
      return { filePath };
    } catch (error) {
      console.error('获取书籍文件路径失败:', error);
      return { filePath: null, error: String(error) };
    }
  });
}
