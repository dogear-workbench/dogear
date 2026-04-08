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
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { getAllTools } from '../agents/tools/tool-registry.js';
import type { RendererHandlers } from './renderer-handlers.js';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';
import path from 'path';
import fs from 'fs/promises';
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

/** 广播对话运行状态变化给所有渲染层窗口 */
function broadcastConversationRunning(conversationId: string, isRunning: boolean): void {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      h.conversationRunningStateChanged.send({ conversationId, isRunning });
    } catch { /* 窗口已销毁 */ }
  }
}

const t = tipc.create();

// 模块加载时注册广播函数：所有 session 的消息统一广播给所有渲染层窗口
// 放在模块级确保 bot 直接创建的 session 也能广播（不依赖 tipc createQueryBasedSession 路径）
getQueryBasedSessionManager().setBroadcaster((sessionId, event, payload) => {
  // 会话完成时，广播对话运行状态 → not running（在窗口循环之外执行一次）
  if (event === 'complete') {
    const convId = getQueryBasedSessionManager().getConversationIdBySession(sessionId);
    if (convId) broadcastConversationRunning(convId, false);
  }

  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      if (event === 'message') {
        h.queryBasedSessionMessage.send({ sessionId, message: payload as ExtendedSessionMessage });
      } else if (event === 'complete') {
        h.queryBasedSessionComplete.send({ sessionId, result: payload });
      } else if (event === 'error') {
        h.queryBasedSessionMessage.send({ sessionId, message: payload as ExtendedSessionMessage });
      }
    } catch { /* 窗口已销毁，忽略 */ }
  }
});

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

  openWechatWindow: t.procedure
    .action(async () => {
      const { createWechatWindow } = await import('../index.js');
      createWechatWindow();
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
  // 兼容层：委托 ConversationRuntimeService 处理。主路径已迁移到 attachConversationRuntime。
  createQueryBasedSession: t.procedure
    .input<{
      allowedTools?: string[];
      context?: { bookId?: string; chapterId?: string; selectedText?: string };
      enableSkills?: boolean;
      projectRoot?: string;
      conversationId?: string;
      workspaceId?: string;
      resume?: string;
      forkSession?: boolean;
      resumeSessionAt?: string;
      isForkNewConversation?: boolean;
      agents?: Record<string, any>;
      personaId?: string;
      tempPrompt?: string;
    }>()
    .action(async ({ input, context }) => {
      try {
        if (!input.conversationId || !input.workspaceId) {
          return { error: 'conversationId 和 workspaceId 为必填项' };
        }
        const result = await conversationRuntimeService.attachConversation(
          input.conversationId,
          input.workspaceId,
          'desktop',
          {
            resume: input.resume,
            forkSession: input.forkSession,
            resumeSessionAt: input.resumeSessionAt,
            clearForkFields: input.forkSession,
          },
        );
        // 复用已有 session 时重播当前 turn 快照
        if (!result.created && result.snapshot.length > 0) {
          setTimeout(() => {
            if (context.sender.isDestroyed()) return;
            const h = getRendererHandlers<RendererHandlers>(context.sender);
            for (const msg of result.snapshot) {
              try { h.queryBasedSessionMessage.send({ sessionId: result.sessionId, message: msg }); } catch { /* 忽略 */ }
            }
          }, 100);
        }
        return { sessionId: result.sessionId, permissionMode: result.permissionMode };
      } catch (error) {
        console.error('createQueryBasedSession 失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  sendQueryBasedSessionMessage: t.procedure
    .input<{
      sessionId: string;
      content: string;
      textBlocks?: Array<{ text: string }>;
      images?: Array<{ media_type: string; data: string }>;
    }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };

        // 广播对话运行状态 → running
        const convId = sessionManager.getConversationIdBySession(input.sessionId);
        if (convId) broadcastConversationRunning(convId, true);

        // 有多个 textBlocks 或图像附件时，构建 ContentBlock 数组
        const hasMultiBlocks = (input.textBlocks && input.textBlocks.length > 0) || (input.images && input.images.length > 0);
        if (hasMultiBlocks) {
          const contentBlocks: Array<{ type: string; [key: string]: any }> = [];
          // 多文本块（引用上下文 + 用户消息，各自独立）
          if (input.textBlocks && input.textBlocks.length > 0) {
            for (const block of input.textBlocks) {
              contentBlocks.push({ type: 'text', text: block.text });
            }
          } else if (input.content) {
            contentBlocks.push({ type: 'text', text: input.content });
          }
          // 图像块
          if (input.images) {
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
        // 使用 release 而非直接 close：引用计数归零才真正销毁（支持多持有者共享 session）
        sessionManager.release(input.sessionId);
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
          /** 消息来源类型（"external" 表示真实用户输入，其他值为 SDK 注入消息） */
          userType?: string;
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
                // 消息来源类型（"external" 表示真实用户输入）
                userType: parsed.userType,
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
          /** 消息来源类型（"external" 表示真实用户输入，其他值为 SDK 注入消息） */
          userType?: string;
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
              // 传递消息来源类型，供前端区分真实用户输入与 SDK 注入消息
              userType: msg.userType,
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
              // 同步更新 uuid 为最新行的 uuid，与 transformers.ts 的 historyTransformer 行为一致
              // 这样 fork_pending 预览截断时能正确找到分叉点（前端 sdkUuid 存的是最后一条行的 uuid）
              if (msg.uuid) currentAssistantMessage.uuid = msg.uuid;
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

  // 获取所有已注册的工具元数据（SDK 内置 + 自定义）
  getRegisteredTools: t.procedure
    .action(async () => {
      // 触发工具文件的模块加载（确保 registerTools 被调用）
      await import('../agents/tools/article-tools.js').catch(() => {});
      await import('../agents/tools/book-qa-tools.js').catch(() => {});
      await import('../agents/tools/book-analysis-tools.js').catch(() => {});
      await import('../agents/tools/stock-tools.js').catch(() => {});
      return getAllTools();
    }),
};
