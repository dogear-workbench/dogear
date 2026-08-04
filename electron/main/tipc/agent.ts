// electron/main/tipc/agent.ts
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { getAgentManager } from '../agents/agent-manager.js';
import { AgentTask, TaskType, ChatSessionPayload } from '../agents/task-types.js';
import { sendToDebugWindow } from '../index.js';
import {
  getQueryBasedSessionManager
} from '../agents/query-based-session.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { getAllTools } from '../agents/tools/tool-registry.js';
import type { RendererHandlers } from './renderer-handlers.js';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';
import * as conversationService from '../services/conversation-service.js';
import { getClaudeConfigDir, getSdkSessionsDir } from '../services/memory/session-paths.js';
export { getClaudeConfigDir } from '../services/memory/session-paths.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import electron from 'electron';

// 获取当前文件的路径 (ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 计算项目根目录（tipc -> main -> electron -> 项目根目录）
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

// bot 状态 getter（由 wechat.ts startPolling 时注入，避免循环导入）
type BotStateGetter = () => { activeSessionId: string | null } | null;
let _botStateGetter: BotStateGetter | null = null;
export function registerBotStateGetter(getter: BotStateGetter): void {
  _botStateGetter = getter;
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

  // 如果 user 消息来自 bot session，打上 source 标记
  let messagePayload = payload;
  if (event === 'message') {
    const msg = payload as ExtendedSessionMessage;
    if (msg.type === 'user' && _botStateGetter) {
      const botState = _botStateGetter();
      if (botState?.activeSessionId === sessionId) {
        messagePayload = { ...msg, source: 'wechat-bot' };
      }
    }
  }

  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      if (event === 'message') {
        h.queryBasedSessionMessage.send({ sessionId, message: messagePayload as ExtendedSessionMessage });
      } else if (event === 'complete') {
        h.queryBasedSessionComplete.send({ sessionId, result: payload });
      } else if (event === 'error') {
        h.queryBasedSessionMessage.send({ sessionId, message: payload as ExtendedSessionMessage });
      }
    } catch { /* 窗口已销毁，忽略 */ }
  }
});

// pi 会话广播：与上面 QueryBasedSessionManager 的广播逻辑对称但相互独立
// （阶段一没有 bot 来源标记 / running-state legacy 广播，events 复用同一套 IPC 事件名）
getPiSessionManager().setBroadcaster((sessionId, event, payload) => {
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
      } else if (event === 'permissionRequest') {
        const data = payload as { requestId: string; toolName: string; toolInput: unknown };
        h.permissionRequest.send({ sessionId, requestId: data.requestId, toolName: data.toolName, toolInput: data.toolInput });
      } else if (event === 'pendingCountChanged') {
        const data = payload as { count: number };
        h.pendingCountChanged.send({ sessionId, count: data.count });
      } else if (event === 'sessionStateChanged') {
        const data = payload as { conversationId: string; running: boolean; pendingAction: boolean };
        h.sessionStateChanged.send(data);
      } else if (event === 'sessionClosed') {
        const data = payload as { conversationId: string };
        h.sessionClosed.send(data);
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
      // 关闭前捕获 conversationId（关闭后映射可能被清理），供提炼脏检查用
      const convId = getQueryBasedSessionManager().getConversationIdBySession(input.sessionId);
      const taskId = await agentManager.submitTask(task);
      agentManager.unregisterSessionCallbacks(input.sessionId);
      // 触发点③：延迟 3s 让 JSONL 落盘后，对该会话所属组做脏检查
      if (convId) {
        setTimeout(() => {
          void import('../services/memory/group-digest-trigger.js')
            .then((m) => m.triggerByConversation(convId))
            .catch(() => { /* 后台任务，失败不影响关会话 */ });
        }, 3000);
      }
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

  // ── 基于 Query 的会话（支持 Skills）────────────────────────
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
        const piSessionManager = getPiSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        // pi 会话：方法面对齐（sendMessage 签名一致），未命中 SDK manager 时按 sessionId 试 PiSessionManager
        const piSession = session ? undefined : piSessionManager.getSession(input.sessionId);
        const activeSession = session ?? piSession;
        if (!activeSession) return { error: '会话不存在' };

        // 广播对话运行状态 → running（legacy 事件，pi 阶段一暂不接入，不影响主链路）
        const convId = session
          ? sessionManager.getConversationIdBySession(input.sessionId)
          : piSessionManager.getConversationIdBySession(input.sessionId);
        if (convId && session) broadcastConversationRunning(convId, true);

        // 自动 title：如果对话的 title 仍是默认值"新对话"，用这条消息的前 30 字替换。
        // 只跑一次（后续消息 title 已不是默认值）。用户文本优先取 textBlocks 最后一个块（用户输入在引用之后），否则用 content。
        // 失败不影响发送流程，只记日志。
        if (convId) {
          try {
            const lookup = await conversationService.getByIdGlobal(convId);
            if (lookup) {
              const userText =
                (input.textBlocks && input.textBlocks.length > 0
                  ? input.textBlocks[input.textBlocks.length - 1].text
                  : input.content) || '';
              if (userText) {
                await conversationService.autoUpdateTitleFromFirstMessage(
                  lookup.workspaceId,
                  convId,
                  userText,
                );
              }
            }
          } catch (e) {
            console.warn('[autoTitle] 更新失败（不影响消息发送）:', e);
          }
        }

        // 有多个 textBlocks 或图像附件时，构建 ContentBlock 数组
        const hasMultiBlocks = (input.textBlocks && input.textBlocks.length > 0) || (input.images && input.images.length > 0);
        if (hasMultiBlocks) {
          // 使用 any[] 构建块，发送前由 sendMessage 的参数类型校验；
          // SDK 0.2.119 起 ContentBlockParam 类型更严格，但这里的字段（text/image+base64）都符合规范
          const contentBlocks: any[] = [];
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
          await activeSession.sendMessage(contentBlocks);
        } else {
          await activeSession.sendMessage(input.content);
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
        const piSessionManager = getPiSessionManager();
        // 使用 release 而非直接 close：引用计数归零才真正销毁（支持多持有者共享 session）
        // sessionId 由各自 Manager 用 uuidv4() 独立生成，试两个 Manager 无冲突风险
        if (sessionManager.getSession(input.sessionId)) {
          sessionManager.release(input.sessionId);
        } else {
          await piSessionManager.release(input.sessionId);
        }
        return { success: true };
      } catch (error) {
        console.error('关闭基于 Query 的会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 强制终止会话，忽略引用计数（供 /clear 等需要立即打断执行中任务的场景使用） */
  forceCloseQueryBasedSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        sessionManager.closeSession(input.sessionId);
        return { success: true };
      } catch (error) {
        console.error('强制关闭基于 Query 的会话失败:', error);
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
        // pi 会话：方法面对齐（interrupt 签名一致），未命中 SDK manager 时按 sessionId 试 PiSessionManager
        const activeSession = session ?? getPiSessionManager().getSession(input.sessionId);
        if (!activeSession) return { error: '会话不存在' };
        await activeSession.interrupt();
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
        // pi 会话：方法面对齐（setPermissionMode 签名一致），未命中 SDK manager 时按 sessionId 试 PiSessionManager
        const activeSession = session ?? getPiSessionManager().getSession(input.sessionId);
        if (!activeSession) return { error: '会话不存在' };
        await activeSession.setPermissionMode(input.mode);
        return { success: true };
      } catch (error) {
        console.error('更改权限模式失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 响应权限确认请求（用户允许/拒绝/总是允许工具执行，可选编辑后的参数） */
  respondPermissionRequest: t.procedure
    .input<{ sessionId: string; requestId: string; behavior: 'allow' | 'deny' | 'always_allow' | 'allow_session'; message?: string; updatedInput?: Record<string, unknown> }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        // pi 会话：方法面对齐（respondPermissionRequest 签名一致），未命中 SDK manager 时按 sessionId 试 PiSessionManager
        const activeSession = session ?? getPiSessionManager().getSession(input.sessionId);
        if (!activeSession) return { error: '会话不存在' };
        activeSession.respondPermissionRequest(input.requestId, input.behavior, input.message, input.updatedInput);
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

  /** 切换会话模型选择（同 profile 换 tier 走 SDK 快速路径；跨 profile 返回 needsRestart） */
  setSessionModel: t.procedure
    .input<{ sessionId: string; selection: import('../services/settings-types.js').ModelSelection }>()
    .action(async ({ input }) => {
      try {
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId) ?? getPiSessionManager().getSession(input.sessionId);
        if (!session) {
          return { ok: false as const, error: 'session_not_found' };
        }
        return await session.setModel(input.selection);
      } catch (error) {
        console.error('切换会话模型失败:', error);
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /**
   * 切换会话缓存策略：env 是 SDK 启动级，切换必然 needsRestart=true。
   * 先写对话表（持久化策略），再标记会话需重启。无 active session 时只写库返回 needsRestart=false。
   */
  setSessionCachePolicy: t.procedure
    .input<{ sessionId: string; workspaceId: string; conversationId: string; policy: '5m' | '1h' }>()
    .action(async ({ input }) => {
      try {
        const conversationService = await import('../services/conversation-service.js');
        await conversationService.updateCachePolicy(
          input.workspaceId,
          input.conversationId,
          input.policy,
        );
        const sessionManager = getQueryBasedSessionManager();
        const session = sessionManager.getSession(input.sessionId);
        if (!session) {
          return { ok: true as const, needsRestart: false };
        }
        return session.setCachePolicy(input.policy);
      } catch (error) {
        console.error('切换会话缓存策略失败:', error);
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // ── Harness 会话历史读取（以 Conversation 为入口）────────────
  /**
   * 通用会话历史 IPC：以 conversationId 为入口，主进程自行判断走哪条路径。
   * - archived_legacy：archiveReason 为 SDK 主会话移除迁移写入的冻结标记，不回放旧 SDK JSONL
   * - empty：conversation 尚无 sessionId（新对话，从未发送过消息）
   * - ok：读取 Harness 当前 branch 并转换为前端消息格式
   */
  getConversationHistory: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conv = await conversationService.getById(input.workspaceId, input.conversationId);
        if (!conv) return { status: 'error' as const, error: '对话不存在' };

        if (conv.archivedAt && conv.archiveReason === conversationService.ARCHIVE_REASON_SDK_MAIN_SESSION_REMOVED) {
          return { status: 'archived_legacy' as const, archivedAt: conv.archivedAt };
        }

        if (!conv.sessionId) {
          return { status: 'empty' as const, messages: [] };
        }

        const { buildSessionHistory } = await import('../agents/pi-session/history-adapter.js');
        const messages = await buildSessionHistory(input.workspaceId, conv.sessionId);
        return { status: 'ok' as const, messages };
      } catch (error) {
        console.error('读取对话历史失败:', error);
        return { status: 'error' as const, error: error instanceof Error ? error.message : String(error) };
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
        const sessionsDir = getSdkSessionsDir(projectRoot);

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
        const sessionsDir = getSdkSessionsDir(projectRoot);
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
      await import('../agents/tools/stock-tools.js').catch(() => {});
      await import('../agents/tools/stock-analysis-tools.js').catch(() => {});
      return getAllTools();
    }),

  // 获取可选工具包清单（含启用状态），供设置页 ToolPacksTab 使用
  listToolPacks: t.procedure
    .action(async () => {
      const { OPTIONAL_TOOL_PACKS } = await import('../services/tool-packs.js');
      const { loadSettings } = await import('../services/settings-service.js');
      const settings = await loadSettings();
      const enabled = new Set(settings.enabledToolPacks ?? []);
      return OPTIONAL_TOOL_PACKS.map((pack) => ({
        name: pack.name,
        label: pack.label,
        description: pack.description,
        mcpServer: pack.mcpServerName,
        toolCount: pack.toolCount,
        requiresWorkspace: pack.requiresWorkspace,
        requirements: pack.requirements,
        enabled: enabled.has(pack.name),
      }));
    }),

  // 弹出独立会话窗口
  openSessionWindow: t.procedure
    .input<{ conversationId: string; title: string }>()
    .action(async ({ input }) => {
      const { createSessionWindow } = await import('../index.js');
      createSessionWindow(input.conversationId, input.title);
      return { success: true };
    }),

};
