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
import fs from 'fs/promises';
import os from 'os';

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
   * 支持通过 resume 参数恢复之前的会话
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
    conversationId?: string;       // 对话ID（用于恢复会话）
    resume?: string;               // SDK session_id（用于 resume）
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
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
        resume: config.resume  // 传递 resume 参数
      };

      // 创建会话
      const session = sessionManager.createSession(sessionConfig);

      // 启动会话
      await session.start();

      // 监听 SDK session_id 初始化事件，保存到数据库
      session.on('session_init', async (data: { session_id: string }) => {
        console.log('=== 收到 SDK session_id ===');
        console.log('SDK session_id:', data.session_id);
        console.log('conversationId:', config.conversationId);
        console.log('resume 参数:', config.resume);

        // 如果有 conversationId，保存 sdk_session_id 到数据库
        if (config.conversationId) {
          const { dbConversations } = await import('../database/index.js');
          dbConversations.updateSdkSessionId(config.conversationId, data.session_id);
          console.log('✅ 已保存 sdk_session_id 到数据库');
        }

        // 同时发送到前端
        if (event.sender) {
          event.sender.send('agent:queryBasedSessionInit', {
            sessionId: session.getSessionId(),
            sdkSessionId: data.session_id
          });
        }
      });

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

  // ==================== SDK 会话历史读取 ====================

  /**
   * 获取 SDK 会话的存储目录
   * 格式: ~/.claude/projects/{normalized-project-path}/
   */
  async function getSdkSessionsDir(projectPath: string): Promise<string> {
    // 规范化项目路径：将反斜杠替换为双横线，移除冒号
    const normalized = projectPath
      .replace(/\\/g, '--')  // Windows: C:\path → C--path
      .replace(/:/g, '')      // 移除驱动器冒号: C: → C
      .toLowerCase();

    return path.join(os.homedir(), '.claude', 'projects', normalized);
  }

  /**
   * 从 SDK 的会话文件中读取历史消息
   */
  ipcMain.handle('agent:getSdkSessionHistory', async (_, sdkSessionId: string, projectPath?: string) => {
    try {
      // 确定项目路径（用于定位会话存储目录）
      const projectRoot = projectPath || process.cwd();
      const sessionsDir = await getSdkSessionsDir(projectRoot);
      const sessionFile = path.join(sessionsDir, `${sdkSessionId}.jsonl`);

      console.log('读取 SDK 会话历史:', {
        sdkSessionId,
        projectRoot,
        sessionsDir,
        sessionFile
      });

      // 检查文件是否存在
      try {
        await fs.access(sessionFile);
      } catch {
        return { messages: [], error: '会话文件不存在' };
      }

      // 读取 JSONL 文件
      const content = await fs.readFile(sessionFile, 'utf-8');
      const lines = content.trim().split('\n');

      // 解析每行 JSON，先收集所有原始消息
      const rawMessages: Array<{
        type: string;
        message?: any;
        timestamp?: string;
        uuid?: string;
      }> = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          // 只提取用户、助手和 tool_result 消息（忽略 queue-operation、file-history-snapshot 等）
          if (
            (parsed.type === 'user' && parsed.message) ||
            (parsed.type === 'assistant' && parsed.message) ||
            (parsed.message?.role === 'tool_result')
          ) {
            rawMessages.push({
              type: parsed.type,
              message: parsed.message,
              timestamp: parsed.timestamp,
              uuid: parsed.uuid
            });
          }
        } catch (e) {
          // 忽略解析失败的行
        }
      }

      // 合并连续的 assistant 消息，并构建最终的消息列表
      const historyMessages: Array<{
        type: string;
        role?: string;
        content?: any;
        timestamp?: string;
        uuid?: string;
      }> = [];

      // 当前正在合并的 assistant 消息
      let currentAssistantMessage: {
        type: string;
        role: string;
        content: any[];
        timestamp?: string;
        uuid?: string;
      } | null = null;

      for (const msg of rawMessages) {
        // 用户消息：直接添加，并完成之前的 assistant 消息合并
        if (msg.type === 'user' && msg.message) {
          if (currentAssistantMessage) {
            historyMessages.push({ ...currentAssistantMessage });
            currentAssistantMessage = null;
          }
          historyMessages.push({
            type: 'user',
            role: msg.message.role,
            content: msg.message.content,
            timestamp: msg.timestamp,
            uuid: msg.uuid
          });
        }
        // 助手消息：可能与之前的 assistant 消息合并
        else if (msg.type === 'assistant' && msg.message) {
          const contentBlocks = Array.isArray(msg.message.content)
            ? msg.message.content
            : (typeof msg.message.content === 'string'
                ? [{ type: 'text', text: msg.message.content }]
                : []);

          if (!currentAssistantMessage) {
            // 开始新的 assistant 消息
            currentAssistantMessage = {
              type: 'assistant',
              role: 'assistant',
              content: contentBlocks,
              timestamp: msg.timestamp,
              uuid: msg.uuid
            };
          } else {
            // 合并到当前的 assistant 消息
            currentAssistantMessage.content.push(...contentBlocks);
            // 更新时间戳为最后一个消息的时间
            currentAssistantMessage.timestamp = msg.timestamp;
          }
        }
        // tool_result 消息：忽略（它们是工具执行的结果，不需要显示）
        // 如果需要显示，可以将其附加到前面的 assistant 消息中
      }

      // 添加最后的 assistant 消息
      if (currentAssistantMessage) {
        historyMessages.push(currentAssistantMessage);
      }

      console.log(`✅ 读取到 ${historyMessages.length} 条历史消息（已合并连续的 assistant 消息）`);

      return { messages: historyMessages };
    } catch (error) {
      console.error('读取 SDK 会话历史失败:', error);
      return { messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 获取所有 SDK 会话列表（从 sessions-index.json）
   */
  ipcMain.handle('agent:getSdkSessions', async (_, projectPath?: string) => {
    try {
      const projectRoot = projectPath || process.cwd();
      const sessionsDir = await getSdkSessionsDir(projectRoot);
      const indexPath = path.join(sessionsDir, 'sessions-index.json');

      console.log('读取 SDK 会话索引:', {
        projectRoot,
        sessionsDir,
        indexPath
      });

      // 检查索引文件是否存在
      try {
        await fs.access(indexPath);
      } catch {
        return { sessions: [], error: '会话索引文件不存在' };
      }

      // 读取索引文件
      const content = await fs.readFile(indexPath, 'utf-8');
      const data = JSON.parse(content);

      console.log(`✅ 找到 ${data.entries?.length || 0} 个会话`);

      return { sessions: data.entries || [] };
    } catch (error) {
      console.error('读取 SDK 会话列表失败:', error);
      return { sessions: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
}
