// electron/main/tipc/agent.ts
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
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
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { createBookQATools } from '../agents/tools/book-qa-tools.js';
import { createArticleTools } from '../agents/tools/article-tools.js';
import { createStockTools } from '../agents/tools/stock-tools.js';
import type { RendererHandlers } from './renderer-handlers.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { loadWorkspaceAgents } from '../services/agent-definition-service.js';
import { fileURLToPath } from 'url';
import electron from 'electron';
const { app } = electron;

// 获取当前文件的路径 (ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 计算项目根目录（tipc -> main -> electron -> 项目根目录）
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

/**
 * 获取 CLAUDE_CONFIG_DIR 路径
 * 与 query-based-session.ts 中设置的 env.CLAUDE_CONFIG_DIR 保持一致
 */
export function getClaudeConfigDir(): string {
  const appDir = app.isPackaged
    ? app.getPath('userData')  // 生产环境：AppData/Roaming/Dogear
    : process.cwd();           // 开发环境：项目根目录
  return path.join(appDir, '.dogear', 'conversations');
}

/**
 * 获取 SDK 会话的存储目录
 * 路径规则与 CLI 内部一致：{CLAUDE_CONFIG_DIR}/projects/{normalized_path}
 */
async function getSdkSessionsDir(projectPath: string): Promise<string> {
  let normalized: string;
  if (process.platform === 'win32') {
    normalized = projectPath.replace(/\\/g, '-').replace(/:/g, '-');
  } else {
    normalized = projectPath.replace(/\//g, '-');
  }
  const configDir = getClaudeConfigDir();
  return path.join(configDir, 'projects', normalized);
}

const t = tipc.create();

export const agentRouter = {
  // ── 旧版 Agent 任务 ──────────────────────────────────────
  submitTask: t.procedure
    .input<{ task: AgentTask }>()
    .action(async ({ input, context }) => {
      const agentManager = getAgentManager();
      const handlers = getRendererHandlers<RendererHandlers>(context.sender);
      const taskId = await agentManager.submitTask(input.task, (taskId, status, result, error) => {
        handlers.agentTaskUpdate.send({ taskId, status, result, error });
        sendToDebugWindow('debug:taskUpdate', { taskId, status, result, error });
        if (result?.message) {
          sendToDebugWindow('debug:agentMessage', { role: 'assistant', content: result.message, timestamp: Date.now() });
        }
      });

      // 如果是会话任务，注册会话消息回调
      if (input.task.type === TaskType.CHAT_SESSION && input.task.payload?.action === 'start') {
        agentManager.registerSessionCallback(taskId, (sessionId, message) => {
          handlers.agentSessionMessage.send({ sessionId, message });
          sendToDebugWindow('debug:agentMessage', { role: 'assistant', content: message, timestamp: Date.now() });
        });
      }
      return { taskId };
    }),

  sendSessionMessage: t.procedure
    .input<{ sessionId: string; message: { role: string; content: string } }>()
    .action(async ({ input, context }) => {
      const agentManager = getAgentManager();
      const handlers = getRendererHandlers<RendererHandlers>(context.sender);
      const task: AgentTask = {
        id: `msg-${Date.now()}`,
        type: TaskType.CHAT_SESSION,
        status: 'pending' as any,
        payload: { action: 'message', sessionId: input.sessionId, message: input.message } as ChatSessionPayload,
        createdAt: Date.now(),
      };
      const taskId = await agentManager.submitTask(task, (taskId, status, result, error) => {
        handlers.agentTaskUpdate.send({ taskId, status, result, error });
      });
      return { taskId };
    }),

  closeSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      const agentManager = getAgentManager();
      const task: AgentTask = {
        id: `close-${Date.now()}`,
        type: TaskType.CHAT_SESSION,
        status: 'pending' as any,
        payload: { action: 'close', sessionId: input.sessionId } as ChatSessionPayload,
        createdAt: Date.now(),
      };
      const taskId = await agentManager.submitTask(task);
      agentManager.unregisterSessionCallbacks(input.sessionId);
      return { taskId, success: true };
    }),

  cancelTask: t.procedure
    .input<{ taskId: string }>()
    .action(async ({ input }) => {
      getAgentManager().cancelTask(input.taskId);
      return { success: true };
    }),

  getStatus: t.procedure
    .action(async () => getAgentManager().getStatus()),

  getDetailedStatus: t.procedure
    .action(async () => getAgentManager().getDetailedStatus()),

  openMonitorWindow: t.procedure
    .action(async () => {
      const { createAgentMonitorWindow } = await import('../index.js');
      createAgentMonitorWindow();
      return { success: true };
    }),

  openStockWindow: t.procedure
    .action(async () => {
      const { createStockWindow } = await import('../index.js');
      createStockWindow();
      return { success: true };
    }),

  // ── 书籍分析 v2 ──────────────────────────────────────────
  analyzeBook: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input, context }) => {
      try {
        const agentManager = getAgentManager();
        const handlers = getRendererHandlers<RendererHandlers>(context.sender);
        const task: AgentTask = {
          id: '',
          type: TaskType.ANALYZE_BOOK,
          status: 'pending' as any,
          payload: { bookId: input.bookId },
          createdAt: Date.now(),
        };
        const taskId = await agentManager.submitTask(task, (taskId, status, result, error) => {
          handlers.analysisUpdate.send({
            bookId: input.bookId,
            taskId,
            status,
            result,
            error,
          });
        });
        return { taskId };
      } catch (error) {
        console.error('启动书籍分析失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getAnalysisStatus: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      try {
        const workspaceService = await import('../services/workspace-service.js');
        const workspace = await workspaceService.getCurrentWorkspace();
        if (!workspace) {
          return { status: 'none' as const, result: null, error: '未设置默认工作区' };
        }
        const status = await workspaceService.loadAnalysisStatus(workspace, input.bookId);
        const result = await workspaceService.loadAnalysisResult(workspace, input.bookId);
        return {
          status: status?.analysisStatus || 'none',
          result: result || null,
        };
      } catch (error) {
        console.error('获取分析状态失败:', error);
        return { status: 'none' as const, result: null, error: String(error) };
      }
    }),

  getChapterAnalyses: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      try {
        const workspaceService = await import('../services/workspace-service.js');
        const workspace = await workspaceService.getCurrentWorkspace();
        if (!workspace) {
          return { analyses: [], error: '未设置默认工作区' };
        }
        const analyses = await workspaceService.loadChapterAnalyses(workspace, input.bookId);
        return { analyses };
      } catch (error) {
        console.error('获取章节分析失败:', error);
        return { analyses: [], error: String(error) };
      }
    }),

  chatWithAnalysis: t.procedure
    .input<{ bookId: string; message: string }>()
    .action(async ({ input, context }) => {
      try {
        const agentManager = getAgentManager();
        const handlers = getRendererHandlers<RendererHandlers>(context.sender);

        // 创建聊天会话任务
        const task: AgentTask = {
          id: '',
          type: TaskType.CHAT_SESSION,
          status: 'pending' as any,
          payload: {
            action: 'start',
            context: { bookId: input.bookId },
          } as ChatSessionPayload,
          createdAt: Date.now(),
        };

        const sessionId = await agentManager.submitTask(task, (taskId, status, result, error) => {
          handlers.agentTaskUpdate.send({ taskId, status, result, error });
        });

        // 注册会话消息回调
        agentManager.registerSessionCallback(sessionId, async (sid, msg) => {
          handlers.agentSessionMessage.send({
            sessionId: sid,
            message: msg,
          });
        });

        // 发送用户的第一个消息
        const chatTask: AgentTask = {
          id: `chat-${Date.now()}`,
          type: TaskType.CHAT_SESSION,
          status: 'pending' as any,
          payload: {
            action: 'message',
            sessionId,
            message: { role: 'user', content: input.message },
          } as ChatSessionPayload,
          createdAt: Date.now(),
        };
        await agentManager.submitTask(chatTask);

        return { sessionId };
      } catch (error) {
        console.error('启动分析对话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getBookFilePath: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      try {
        const workspaceService = await import('../services/workspace-service.js');
        const workspace = await workspaceService.getCurrentWorkspace();
        if (!workspace) {
          return { filePath: null, error: '未设置默认工作区' };
        }
        const bookService = await import('../services/book-service.js');
        const book = await bookService.getBookById(input.bookId);
        if (!book) {
          return { filePath: null, error: '书籍不存在' };
        }
        const filePath = await workspaceService.getBookFilePath(workspace, input.bookId, book.file_path);
        return { filePath };
      } catch (error) {
        console.error('获取书籍文件路径失败:', error);
        return { filePath: null, error: String(error) };
      }
    }),

  // ── 主进程会话（SDK v2）──────────────────────────────────
  createMainProcessSession: t.procedure
    .input<{
      model?: string;
      allowedTools?: string[];
      context?: { bookId?: string; chapterId?: string; selectedText?: string };
    }>()
    .action(async ({ input, context }) => {
      try {
        const sessionManager = getMainProcessSessionManager();
        const handlers = getRendererHandlers<RendererHandlers>(context.sender);

        // 获取工作区路径
        let workspacePath = '';
        const workspaceJsonService = await import('../services/workspace-json-service.js');
        const defaultWorkspace = await workspaceJsonService.getDefault();
        if (defaultWorkspace) {
          workspacePath = defaultWorkspace.path;
        }

        const session = sessionManager.createSession({
          model: input.model,
          allowedTools: input.allowedTools || ['Read', 'Glob', 'Grep'],
          context: input.context,
          workspacePath,
        });

        await session.start();

        // 注册会话消息监听器
        sessionManager.on('sessionMessage', (sessionId: string, message: ExtendedSessionMessage) => {
          if (sessionId === session.getSessionId()) {
            handlers.mainProcessSessionMessage.send({ sessionId, message });
          }
        });

        return { sessionId: session.getSessionId() };
      } catch (error) {
        console.error('创建主进程会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  sendMainProcessSessionMessage: t.procedure
    .input<{ sessionId: string; content: string }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getMainProcessSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };
        await session.sendMessage(input.content);
        return { success: true };
      } catch (error) {
        console.error('发送消息到主进程会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  closeMainProcessSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getMainProcessSessionManager();
        sessionManager.closeSession(input.sessionId);
        return { success: true };
      } catch (error) {
        console.error('关闭主进程会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // ── 基于 Query 的会话（支持 Skills）────────────────────────
  createQueryBasedSession: t.procedure
    .input<{
      allowedTools?: string[];
      context?: { bookId?: string; chapterId?: string; selectedText?: string };
      enableSkills?: boolean;
      projectRoot?: string;
      conversationId?: string;
      workspaceId?: string;  // 对话所属工作区 ID
      resume?: string;
      forkSession?: boolean;
      resumeSessionAt?: string;
      isForkNewConversation?: boolean;
      agents?: Record<string, any>;  // 自定义子代理配置（可选）
      personaId?: string;             // 关联的人设 ID
      tempPrompt?: string;            // 临时提示词
    }>()
    .action(async ({ input, context }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const handlers = getRendererHandlers<RendererHandlers>(context.sender);

        // 获取工作区路径
        let workspacePath = '';
        const workspaceJsonService = await import('../services/workspace-json-service.js');
        const defaultWorkspace = await workspaceJsonService.getDefault();
        if (defaultWorkspace) {
          workspacePath = defaultWorkspace.path;
        }

        // 构建 MCP Servers 配置（v5: 改为基于工作区加载所有书籍）
        const mcpServers: Record<string, any> = {};
        if ((input.enableSkills ?? true) && workspacePath) {
          const currentWorkspaceId = defaultWorkspace?.id || 'default';
          const bookQATools = createBookQATools(workspacePath, currentWorkspaceId);
          mcpServers['dogear-book-qa'] = bookQATools;
          console.log('已添加 book-qa MCP tools, workspaceId:', currentWorkspaceId);

          // 注册文章阅读工具（ReadArticle / ListArticles）
          const articleTools = createArticleTools(workspacePath);
          mcpServers['dogear-article'] = articleTools;
          console.log('已添加 article MCP tools');
        }

        // 注册股票行情工具（SearchStock / GetStockQuote / GetKLineData / GetTimeline / GetWatchlist / ModifyWatchlist）
        // 股票工具不依赖工作区路径，始终注册
        const stockTools = createStockTools();
        mcpServers['dogear-stock'] = stockTools;
        console.log('已添加 stock MCP tools');

        // 构建子代理配置：内置默认 < 文件系统 .claude/agents/ < 前端传入
        const agents: Record<string, any> = {};

        // 1. 内置默认代理
        agents['chapter-analyzer'] = {
          description: '分析书籍章节内容，提取摘要、关键概念和结构信息。适用于需要深入分析单个章节的场景。',
          prompt: '你是一个章节分析专家。你的任务是深入分析给定的章节内容，提取关键信息、主题、概念和结构。请使用中文输出分析结果。',
          model: 'haiku',
          tools: ['Read', 'Glob', 'Grep'],
          maxTurns: 5,
        };
        agents['book-searcher'] = {
          description: '在书籍中搜索特定内容，查找相关章节和段落。适用于用户提出关于书籍内容的问题时。',
          prompt: '你是一个书籍内容搜索专家。你的任务是在书籍的章节中搜索与用户问题相关的内容，找到最相关的段落并提供引用。请使用中文回答。',
          model: 'haiku',
          tools: ['Read', 'Glob', 'Grep'],
          maxTurns: 8,
        };

        // 2. 从工作区 .claude/agents/ 加载文件代理（覆盖同名内置代理）
        if (workspacePath) {
          try {
            const fileAgents = await loadWorkspaceAgents(workspacePath);
            for (const fa of fileAgents) {
              agents[fa.agentName] = fa.definition;
              console.log(`已加载工作区代理: ${fa.agentName} (${fa.fileName})`);
            }
          } catch (e) {
            console.warn('加载工作区代理文件失败:', e);
          }
        }

        // 3. 前端传入覆盖（最高优先级）
        if (input.agents) {
          Object.assign(agents, input.agents);
        }

        // 构建会话配置
        const sessionConfig: QueryBasedSessionConfig = {
          allowedTools: input.allowedTools || ['Read', 'Glob', 'Grep'],
          context: input.context,
          workspacePath,
          enableSkills: input.enableSkills ?? true,
          projectRoot: input.projectRoot,
          mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
          resume: input.resume,
          forkSession: input.forkSession,
          resumeSessionAt: input.resumeSessionAt,
          agents: Object.keys(agents).length > 0 ? agents : undefined,
          personaId: input.personaId,
          tempPrompt: input.tempPrompt,
        };

        const session = sessionManager.createSession(sessionConfig);
        await session.start();

        // 监听 SDK session_id 初始化事件，保存到数据库
        session.on('session_init', async (data: { session_id: string }) => {
          console.log('=== 收到 SDK session_id ===');
          console.log('SDK session_id:', data.session_id);
          console.log('conversationId:', input.conversationId);

          if (input.conversationId) {
            const conversationService = await import('../services/conversation-service.js');
            if (input.workspaceId) {
              await conversationService.updateSdkSessionId(input.workspaceId, input.conversationId, data.session_id);
            } else {
              // 兼容：全局查找
              const result = await conversationService.getByIdGlobal(input.conversationId);
              if (result) {
                await conversationService.updateSdkSessionId(result.workspaceId, input.conversationId, data.session_id);
              }
            }
            console.log('已保存 sdk_session_id');
          }

          // 发送到前端（通过 webContents.send，因为 tipc 事件不包含此自定义事件）
          context.sender.send('agent:queryBasedSessionInit', {
            sessionId: session.getSessionId(),
            sdkSessionId: data.session_id,
          });
        });

        // 注册会话能力事件转发（SDK init 消息触发时）
        session.on('session_capabilities', async (data: { slashCommands: string[]; tools: string[]; skills: string[]; mcpServers: Array<{ name: string; status: string }> }) => {
          // 调用 supportedCommands() 获取完整命令描述
          const sdkCommands = await session.getSupportedCommands();
          handlers.sessionCapabilities.send({
            sessionId: session.getSessionId(),
            sdkCommands,
            tools: data.tools,
            skills: data.skills,
            mcpServers: data.mcpServers,
          });
        });

        // 注册权限请求事件转发（canUseTool 回调触发时）
        session.on('permissionRequest', (data: { requestId: string; toolName: string; toolInput: unknown; decisionReason?: string }) => {
          handlers.permissionRequest.send({
            sessionId: session.getSessionId(),
            requestId: data.requestId,
            toolName: data.toolName,
            toolInput: data.toolInput,
            decisionReason: data.decisionReason,
          });
        });

        // 注册 AskUserQuestion 事件转发（SDK AskUserQuestion 工具触发时）
        session.on('askUserQuestion', (data: { requestId: string; questions: any[] }) => {
          handlers.askUserQuestion.send({
            sessionId: session.getSessionId(),
            requestId: data.requestId,
            questions: data.questions,
          });
        });

        // 注册 Notification hook 事件转发
        session.on('notification', (data: { title?: string; message: string; notificationType: string }) => {
          // 通过 tipc 发送到前端
          handlers.agentNotification.send({
            sessionId: session.getSessionId(),
            title: data.title,
            message: data.message,
            notificationType: data.notificationType,
          });

          // 通过 Electron Notification API 发送系统桌面通知
          const { Notification: ElectronNotification } = electron;
          if (ElectronNotification.isSupported()) {
            new ElectronNotification({
              title: data.title || 'Dogear',
              body: data.message,
            }).show();
          }
        });

        // 注册权限模式变更事件转发（后端→前端双向同步）
        session.on('permissionModeChanged', (data: { mode: string }) => {
          handlers.permissionModeChanged.send({
            sessionId: session.getSessionId(),
            mode: data.mode,
          });
        });

        // 注册会话消息监听器
        sessionManager.on('sessionMessage', (sessionId: string, message: ExtendedSessionMessage) => {
          if (sessionId === session.getSessionId()) {
            handlers.queryBasedSessionMessage.send({ sessionId, message });
          }
        });

        // 注册会话完成监听器
        sessionManager.on('sessionComplete', (sessionId: string, result: unknown) => {
          if (sessionId === session.getSessionId()) {
            handlers.queryBasedSessionComplete.send({ sessionId, result });
          }
        });

        // 注册会话错误监听器
        sessionManager.on('sessionError', (sessionId: string, message: ExtendedSessionMessage) => {
          if (sessionId === session.getSessionId()) {
            handlers.queryBasedSessionMessage.send({ sessionId, message });
          }
        });

        // 会话创建后主动推送命令列表，避免用户需等到第一轮对话才能使用斜杠命令
        setTimeout(async () => {
          try {
            const sdkCommands = await session.getSupportedCommands();
            if (sdkCommands.length > 0) {
              handlers.sessionCapabilities.send({
                sessionId: session.getSessionId(),
                sdkCommands,
                tools: [],   // init 消息到达后会更新完整信息
                skills: [],
                mcpServers: [],
              });
            }
          } catch (e) {
            console.warn('主动获取命令列表失败（会话初始化中）:', e);
          }
        }, 100);

        return { sessionId: session.getSessionId(), permissionMode: session.getPermissionMode() };
      } catch (error) {
        console.error('创建基于 Query 的会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  sendQueryBasedSessionMessage: t.procedure
    .input<{ sessionId: string; content: string; images?: Array<{ media_type: string; data: string }> }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };

        // 如果有图像附件，构建 ContentBlock 数组
        if (input.images && input.images.length > 0) {
          const contentBlocks: Array<{ type: string; [key: string]: any }> = [];
          // 文本块
          if (input.content) {
            contentBlocks.push({ type: 'text', text: input.content });
          }
          // 图像块
          for (const img of input.images) {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.media_type,
                data: img.data,
              },
            });
          }
          await session.sendMessage(contentBlocks);
        } else {
          await session.sendMessage(input.content);
        }
        return { success: true };
      } catch (error) {
        console.error('发送消息到基于 Query 的会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  closeQueryBasedSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        sessionManager.closeSession(input.sessionId);
        return { success: true };
      } catch (error) {
        console.error('关闭基于 Query 的会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 获取会话支持的斜杠命令列表 */
  getSessionCapabilities: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };
        const sdkCommands = await session.getSupportedCommands();
        return { sdkCommands };
      } catch (error) {
        console.error('获取会话命令列表失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // ── Query 会话运行时控制 ──────────────────────────────────

  /** 中断当前 AI 执行 */
  interruptQueryBasedSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };
        await session.interrupt();
        return { success: true };
      } catch (error) {
        console.error('中断会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 更改权限模式 */
  setPermissionMode: t.procedure
    .input<{ sessionId: string; mode: PermissionMode }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };
        await session.setPermissionMode(input.mode);
        return { success: true };
      } catch (error) {
        console.error('更改权限模式失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 响应权限确认请求（用户允许/拒绝工具执行，可选编辑后的参数） */
  respondPermissionRequest: t.procedure
    .input<{ sessionId: string; requestId: string; behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };
        session.respondPermissionRequest(input.requestId, input.behavior, input.message, input.updatedInput);
        return { success: true };
      } catch (error) {
        console.error('响应权限请求失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 响应 AskUserQuestion 请求（用户选择/填写答案） */
  respondAskUserQuestion: t.procedure
    .input<{ sessionId: string; requestId: string; answers: Record<string, string> }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };
        session.respondAskUserQuestion(input.requestId, input.answers);
        return { success: true };
      } catch (error) {
        console.error('响应 AskUserQuestion 失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 设置思考 token 上限（0=禁用, null=默认） */
  setMaxThinkingTokens: t.procedure
    .input<{ sessionId: string; maxThinkingTokens: number | null }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };
        await session.setMaxThinkingTokens(input.maxThinkingTokens);
        return { success: true };
      } catch (error) {
        console.error('设置 thinking tokens 失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // ── SDK 会话历史读取 ──────────────────────────────────────
  getSdkSessionHistory: t.procedure
    .input<{ sdkSessionId: string; projectPath?: string }>()
    .action(async ({ input }) => {
      try {
        // 优先使用前端传入的路径，其次使用默认工作区路径，最后 fallback 到项目根目录
        let projectRoot = input.projectPath;
        if (!projectRoot) {
          const workspaceJsonService = await import('../services/workspace-json-service.js');
          const defaultWorkspace = await workspaceJsonService.getDefault();
          projectRoot = defaultWorkspace?.path || PROJECT_ROOT;
        }
        const sessionsDir = await getSdkSessionsDir(projectRoot);
        let sessionFile = path.join(sessionsDir, `${input.sdkSessionId}.jsonl`);

        console.log('读取 SDK 会话历史:', { sdkSessionId: input.sdkSessionId, projectRoot, sessionsDir, sessionFile });

        // 检查文件是否存在
        let fileFound = false;
        try {
          await fs.access(sessionFile);
          fileFound = true;
        } catch {
          // 尝试搜索工作区路径
          console.log('会话文件不在项目根目录，尝试搜索工作区目录...');
          try {
            const wsService = await import('../services/workspace-json-service.js');
            const defaultWorkspace = await wsService.getDefault();
            if (defaultWorkspace?.path) {
              const workspaceSessionsDir = await getSdkSessionsDir(defaultWorkspace.path);
              const workspaceSessionFile = path.join(workspaceSessionsDir, `${input.sdkSessionId}.jsonl`);
              console.log('尝试工作区路径:', workspaceSessionFile);
              try {
                await fs.access(workspaceSessionFile);
                sessionFile = workspaceSessionFile;
                fileFound = true;
                console.log('在工作区目录找到会话文件');
              } catch {
                // 工作区目录也没有
              }
            }
          } catch (e) {
            console.warn('搜索工作区目录失败:', e);
          }
        }

        if (!fileFound) {
          return { messages: [], error: '会话文件不存在' };
        }

        // 读取 JSONL 文件
        const content = await fs.readFile(sessionFile, 'utf-8');
        const lines = content.trim().split('\n');

        // 解析每行 JSON
        const rawMessages: Array<{
          type: string;
          message?: any;
          timestamp?: string;
          uuid?: string;
          isMeta?: boolean;
          sourceToolUseID?: string;
          isCompactSummary?: boolean;
          isCompactBoundary?: boolean;
          compactMetadata?: { trigger?: string; preTokens?: number };
          toolUseResult?: any;
        }> = [];

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);

            // 提取 compact_boundary 系统消息（压缩分隔点）
            if (parsed.type === 'system' && parsed.subtype === 'compact_boundary') {
              rawMessages.push({
                type: 'compact_boundary',
                timestamp: parsed.timestamp,
                uuid: parsed.uuid,
                isCompactBoundary: true,
                compactMetadata: parsed.compactMetadata,
              });
              continue;
            }

            if (
              (parsed.type === 'user' && parsed.message) ||
              (parsed.type === 'assistant' && parsed.message) ||
              (parsed.message?.role === 'tool_result')
            ) {
              rawMessages.push({
                type: parsed.type,
                message: parsed.message,
                timestamp: parsed.timestamp,
                uuid: parsed.uuid,
                isMeta: parsed.isMeta || false,
                sourceToolUseID: parsed.sourceToolUseID,
                // 标记压缩摘要消息
                isCompactSummary: parsed.isCompactSummary || false,
                // 保留 toolUseResult（子代理结果元数据）
                toolUseResult: parsed.toolUseResult,
              });
            }
          } catch {
            // 忽略解析失败的行
          }
        }

        // 合并连续的 assistant 消息
        const historyMessages: Array<{
          type: string;
          role?: string;
          content?: any;
          timestamp?: string;
          uuid?: string;
          isMeta?: boolean;
          sourceToolUseID?: string;
          isCompactSummary?: boolean;
          isCompactBoundary?: boolean;
          compactMetadata?: { trigger?: string; preTokens?: number };
          toolUseResult?: any;
        }> = [];

        let currentAssistantMessage: {
          type: string;
          role: string;
          content: any[];
          timestamp?: string;
          uuid?: string;
        } | null = null;

        for (const msg of rawMessages) {
          // compact_boundary：先保存当前 assistant 消息，再插入分隔标记
          if (msg.type === 'compact_boundary') {
            if (currentAssistantMessage) {
              historyMessages.push({ ...currentAssistantMessage });
              currentAssistantMessage = null;
            }
            historyMessages.push({
              type: 'compact_boundary',
              timestamp: msg.timestamp,
              uuid: msg.uuid,
              isCompactBoundary: true,
              compactMetadata: msg.compactMetadata,
            });
          } else if (msg.type === 'user' && msg.message) {
            if (currentAssistantMessage) {
              historyMessages.push({ ...currentAssistantMessage });
              currentAssistantMessage = null;
            }
            historyMessages.push({
              type: 'user',
              role: msg.message.role,
              content: msg.message.content,
              timestamp: msg.timestamp,
              uuid: msg.uuid,
              isMeta: msg.isMeta,
              sourceToolUseID: msg.sourceToolUseID,
              isCompactSummary: msg.isCompactSummary,
              toolUseResult: msg.toolUseResult,
            });
          } else if (msg.type === 'assistant' && msg.message) {
            const contentBlocks = Array.isArray(msg.message.content)
              ? msg.message.content
              : (typeof msg.message.content === 'string'
                  ? [{ type: 'text', text: msg.message.content }]
                  : []);

            if (!currentAssistantMessage) {
              currentAssistantMessage = {
                type: 'assistant',
                role: 'assistant',
                content: contentBlocks,
                timestamp: msg.timestamp,
                uuid: msg.uuid,
              };
            } else {
              currentAssistantMessage.content.push(...contentBlocks);
              currentAssistantMessage.timestamp = msg.timestamp;
            }
          }
        }

        if (currentAssistantMessage) {
          historyMessages.push(currentAssistantMessage);
        }

        console.log(`读取到 ${historyMessages.length} 条历史消息（已合并连续的 assistant 消息）`);
        return { messages: historyMessages };
      } catch (error) {
        console.error('读取 SDK 会话历史失败:', error);
        return { messages: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // ── 子代理会话历史读取 ──────────────────────────────────────
  getSubAgentHistory: t.procedure
    .input<{ sdkSessionId: string; agentId: string; projectPath?: string }>()
    .action(async ({ input }) => {
      try {
        let projectRoot = input.projectPath;
        if (!projectRoot) {
          const workspaceJsonService = await import('../services/workspace-json-service.js');
          const defaultWorkspace = await workspaceJsonService.getDefault();
          projectRoot = defaultWorkspace?.path || PROJECT_ROOT;
        }
        const sessionsDir = await getSdkSessionsDir(projectRoot);

        // 子代理 JSONL 路径：<sessionsDir>/<sessionId>/subagents/agent-<agentId>.jsonl
        const subAgentFile = path.join(sessionsDir, input.sdkSessionId, 'subagents', `agent-${input.agentId}.jsonl`);
        console.log('读取子代理会话历史:', subAgentFile);

        try {
          await fs.access(subAgentFile);
        } catch {
          return { messages: [], error: '子代理会话文件不存在' };
        }

        const content = await fs.readFile(subAgentFile, 'utf-8');
        const lines = content.trim().split('\n');

        // 简化解析：提取 user 和 assistant 消息
        const messages: Array<{
          type: string;
          role?: string;
          content?: any;
          timestamp?: string;
          uuid?: string;
          agentId?: string;
          model?: string;
        }> = [];

        let currentAssistant: {
          type: string;
          role: string;
          content: any[];
          timestamp?: string;
          uuid?: string;
          model?: string;
        } | null = null;

        const flushAssistant = () => {
          if (currentAssistant) {
            messages.push({ ...currentAssistant });
            currentAssistant = null;
          }
        };

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);

            if (parsed.type === 'user' && parsed.message) {
              flushAssistant();
              messages.push({
                type: 'user',
                role: parsed.message.role,
                content: parsed.message.content,
                timestamp: parsed.timestamp,
                uuid: parsed.uuid,
                agentId: parsed.agentId,
              });
            } else if (parsed.type === 'assistant' && parsed.message) {
              const contentBlocks = Array.isArray(parsed.message.content)
                ? parsed.message.content
                : (typeof parsed.message.content === 'string'
                    ? [{ type: 'text', text: parsed.message.content }]
                    : []);

              if (!currentAssistant) {
                currentAssistant = {
                  type: 'assistant',
                  role: 'assistant',
                  content: contentBlocks,
                  timestamp: parsed.timestamp,
                  uuid: parsed.uuid,
                  model: parsed.message?.model,
                };
              } else {
                currentAssistant.content.push(...contentBlocks);
                currentAssistant.timestamp = parsed.timestamp;
              }
            }
          } catch {
            // 忽略解析失败的行
          }
        }

        flushAssistant();

        console.log(`子代理历史: ${messages.length} 条消息`);
        return { messages, agentId: input.agentId };
      } catch (error) {
        console.error('读取子代理会话历史失败:', error);
        return { messages: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getSdkSessions: t.procedure
    .input<{ projectPath?: string }>()
    .action(async ({ input }) => {
      try {
        // 优先使用前端传入的路径，其次使用默认工作区路径，最后 fallback 到项目根目录
        let projectRoot = input.projectPath;
        if (!projectRoot) {
          const workspaceJsonService = await import('../services/workspace-json-service.js');
          const defaultWorkspace = await workspaceJsonService.getDefault();
          projectRoot = defaultWorkspace?.path || PROJECT_ROOT;
        }
        const sessionsDir = await getSdkSessionsDir(projectRoot);
        const indexPath = path.join(sessionsDir, 'sessions-index.json');

        console.log('读取 SDK 会话索引:', { projectRoot, sessionsDir, indexPath });

        try {
          await fs.access(indexPath);
        } catch {
          return { sessions: [], error: '会话索引文件不存在' };
        }

        const content = await fs.readFile(indexPath, 'utf-8');
        const data = JSON.parse(content);
        console.log(`找到 ${data.entries?.length || 0} 个会话`);
        return { sessions: data.entries || [] };
      } catch (error) {
        console.error('读取 SDK 会话列表失败:', error);
        return { sessions: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
