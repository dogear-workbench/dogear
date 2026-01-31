/**
 * Agent 相关 IPC 处理器
 * 处理 Agent 任务提交、取消和状态查询相关的 IPC 请求
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getAgentManager } from '../agents/agent-manager.js';
import { AgentTask, TaskType, ChatSessionPayload } from '../agents/task-types.js';
import { sendToDebugWindow } from '../index.js';
import {
  getMainProcessSessionManager
} from '../agents/main-process-session.js';
import {
  getQueryBasedSessionManager
} from '../agents/query-based-session.js';
import type { ExtendedSessionMessage } from '../agents/main-process-session.js';
import type { QueryBasedSessionConfig } from '../agents/query-based-session.js';
import { createBookQATools } from '../agents/tools/book-qa-tools.js';
import path from 'path';

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
      const workspaceService = await import('../services/workspace-service.js');
      const workspace = await workspaceService.getCurrentWorkspace();
      if (!workspace) {
        return { status: 'none', result: null, error: '未设置默认工作区' };
      }

      const status = await workspaceService.loadAnalysisStatus(workspace, bookId);
      const result = await workspaceService.loadAnalysisResult(workspace, bookId);

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
      const workspaceService = await import('../services/workspace-service.js');
      const workspace = await workspaceService.getCurrentWorkspace();
      if (!workspace) {
        return { analyses: [], error: '未设置默认工作区' };
      }

      const analyses = await workspaceService.loadChapterAnalyses(workspace, bookId);
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
      const workspaceService = await import('../services/workspace-service.js');
      const workspace = await workspaceService.getCurrentWorkspace();
      if (!workspace) {
        return { filePath: null, error: '未设置默认工作区' };
      }

      const { dbBooks } = await import('../database/index.js');
      const book = dbBooks.getById(bookId);
      if (!book) {
        return { filePath: null, error: '书籍不存在' };
      }

      const filePath = await workspaceService.getBookFilePath(workspace, bookId, book.file_path);
      return { filePath };
    } catch (error) {
      console.error('获取书籍文件路径失败:', error);
      return { filePath: null, error: String(error) };
    }
  });

  // ==================== 主进程会话 (v2) ====================
  // 使用 SDK 的 v2 API 在主进程中直接创建会话
  // 会话生命周期与程序相同，不受 Worker 管理影响

  /**
   * 创建主进程会话
   */
  ipcMain.handle('agent:createMainProcessSession', async (event, config: {
    model?: string;
    allowedTools?: string[];
    context?: {
      bookId?: string;
      chapterId?: string;
      selectedText?: string;
    };
  }) => {
    try {
      const sessionManager = getMainProcessSessionManager();

      // 获取工作区路径
      let workspacePath = '';
      const { dbWorkspaces } = await import('../database/index.js');
      const defaultWorkspace = dbWorkspaces.getDefault();
      if (defaultWorkspace) {
        workspacePath = defaultWorkspace.path;
      }

      // 创建会话
      const session = sessionManager.createSession({
        model: config.model,
        allowedTools: config.allowedTools || ['Read', 'Glob', 'Grep'],
        context: config.context,
        workspacePath
      });

      // 启动会话
      await session.start();

      // 注册会话消息监听器，发送到前端
      // 注意：sessionManager 的事件监听器在会话关闭时会自动清理
      sessionManager.on('sessionMessage', (sessionId, message: ExtendedSessionMessage) => {
        if (sessionId === session.getSessionId() && event.sender) {
          event.sender.send('agent:mainProcessSessionMessage', {
            sessionId,
            message
          });
        }
      });

      return {
        sessionId: session.getSessionId()
      };
    } catch (error) {
      console.error('创建主进程会话失败:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 向主进程会话发送消息
   */
  ipcMain.handle('agent:sendMainProcessSessionMessage', async (_, sessionId: string, content: string) => {
    try {
      const sessionManager = getMainProcessSessionManager();
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        return { error: '会话不存在' };
      }

      await session.sendMessage(content);
      return { success: true };
    } catch (error) {
      console.error('发送消息到主进程会话失败:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 关闭主进程会话
   */
  ipcMain.handle('agent:closeMainProcessSession', async (_, sessionId: string) => {
    try {
      const sessionManager = getMainProcessSessionManager();
      sessionManager.closeSession(sessionId);
      return { success: true };
    } catch (error) {
      console.error('关闭主进程会话失败:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ==================== 基于 Query 的会话（支持 Skills）====================

  /**
   * 创建基于 Query 的会话（支持 Skills）
   */
  ipcMain.handle('agent:createQueryBasedSession', async (event, config: {
    model?: string;
    allowedTools?: string[];
    context?: {
      bookId?: string;
      chapterId?: string;
      selectedText?: string;
    };
    enableSkills?: boolean;        // 是否启用 Skill 功能
    projectRoot?: string;          // 项目根目录（用于查找 .claude/skills/）
  }) => {
    try {
      const sessionManager = getQueryBasedSessionManager();

      // 获取工作区路径
      let workspacePath = '';
      const { dbWorkspaces } = await import('../database/index.js');
      const defaultWorkspace = dbWorkspaces.getDefault();
      if (defaultWorkspace) {
        workspacePath = defaultWorkspace.path;
      }

      // 构建 MCP Servers 配置
      const mcpServers: Record<string, any> = {};

      // 如果启用 Skills 或者提供了 bookId，添加 book-qa MCP tools
      // book-qa skill 需要这些工具来搜索书籍内容
      if ((config.enableSkills ?? true) && workspacePath) {
        // 从 context 中获取 bookId，用于创建书籍问答工具
        const bookId = config.context?.bookId;
        const bookQATools = createBookQATools(workspacePath, bookId || '');
        mcpServers['dogear-book-qa'] = bookQATools;
        console.log('已添加 book-qa MCP tools, bookId:', bookId);
      }

      // 构建会话配置
      const sessionConfig: QueryBasedSessionConfig = {
        model: config.model,
        allowedTools: config.allowedTools || ['Read', 'Glob', 'Grep'],
        context: config.context,
        workspacePath,
        enableSkills: config.enableSkills ?? true,  // 默认启用 Skills
        projectRoot: config.projectRoot,
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined
      };

      // 创建会话
      const session = sessionManager.createSession(sessionConfig);

      // 启动会话
      await session.start();

      // 注册会话消息监听器，发送到前端
      sessionManager.on('sessionMessage', (sessionId, message: ExtendedSessionMessage) => {
        if (sessionId === session.getSessionId() && event.sender) {
          event.sender.send('agent:queryBasedSessionMessage', {
            sessionId,
            message
          });
        }
      });

      // 注册会话完成监听器，发送完成消息到前端
      sessionManager.on('sessionComplete', (sessionId, result) => {
        if (sessionId === session.getSessionId() && event.sender) {
          event.sender.send('agent:queryBasedSessionComplete', {
            sessionId,
            result
          });
        }
      });

      // 注册会话错误监听器
      sessionManager.on('sessionError', (sessionId, message: ExtendedSessionMessage) => {
        if (sessionId === session.getSessionId() && event.sender) {
          event.sender.send('agent:queryBasedSessionMessage', {
            sessionId,
            message
          });
        }
      });

      return {
        sessionId: session.getSessionId()
      };
    } catch (error) {
      console.error('创建基于 Query 的会话失败:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 向基于 Query 的会话发送消息
   */
  ipcMain.handle('agent:sendQueryBasedSessionMessage', async (_, sessionId: string, content: string) => {
    try {
      const sessionManager = getQueryBasedSessionManager();
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        return { error: '会话不存在' };
      }

      await session.sendMessage(content);
      return { success: true };
    } catch (error) {
      console.error('发送消息到基于 Query 的会话失败:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 关闭基于 Query 的会话
   */
  ipcMain.handle('agent:closeQueryBasedSession', async (_, sessionId: string) => {
    try {
      const sessionManager = getQueryBasedSessionManager();
      sessionManager.closeSession(sessionId);
      return { success: true };
    } catch (error) {
      console.error('关闭基于 Query 的会话失败:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
}
