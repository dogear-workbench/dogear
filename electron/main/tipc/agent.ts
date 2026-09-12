// electron/main/tipc/agent.ts
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { getAgentManager } from '../agents/agent-manager.js';
import { AgentTask, TaskType } from '../agents/task-types.js';
import { sendToDebugWindow } from '../main-app.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import type { PiSessionTurnResult } from '../agents/pi-session/pi-session.js';
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { PiPermissionMode } from '../agents/pi-session/permission-mode.js';
import type { RendererHandlers } from './renderer-handlers.js';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';
import * as conversationService from '../services/conversation-service.js';
import { getSessionNotificationService } from '../services/session-notification-service.js';
import { mainLogger } from '../agents/logger.js';
import { maybeFailoverMainSession, clearFailoverTriedBySession } from '../agents/model-failover.js';
import { getChildrenByParent } from '../agents/delegation-bridge.js';
import { requireActiveGroup } from '../services/group-service.js';
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

const t = tipc.create();

// 模块加载时注册广播函数：所有 session 的消息统一广播给所有渲染层窗口
getPiSessionManager().setBroadcaster((sessionId, event, payload) => {
  // failed 通知需等 failover 编排返回后再决定发不发（接管则跳过），
  // 其余事件保持原样即时通知
  if (event === 'permissionRequest') {
    void handleSessionNotification(sessionId, event, payload);
  }

  if (event === 'complete') {
    const result = payload as PiSessionTurnResult;
    if (result.subtype === 'success') {
      void clearFailoverTriedBySession(sessionId);
      void handleSessionNotification(sessionId, event, payload);
    } else {
      void maybeFailoverMainSession(sessionId, result).then((tookOver) => {
        if (!tookOver) void handleSessionNotification(sessionId, event, payload);
      });
    }
  }

  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      if (event === 'message') {
        h.queryBasedSessionMessage.send({ sessionId, message: payload as ExtendedSessionMessage });
      } else if (event === 'complete') {
        h.queryBasedSessionComplete.send({ sessionId, result: payload as PiSessionTurnResult });
      } else if (event === 'error') {
        h.queryBasedSessionMessage.send({ sessionId, message: payload as ExtendedSessionMessage });
      } else if (event === 'permissionRequest') {
        const data = payload as { requestId: string; toolName: string; toolInput: unknown };
        h.permissionRequest.send({ sessionId, requestId: data.requestId, toolName: data.toolName, toolInput: data.toolInput });
      } else if (event === 'permissionModeChanged') {
        const data = payload as { mode: PiPermissionMode };
        h.permissionModeChanged.send({ sessionId, mode: data.mode });
      } else if (event === 'pendingCountChanged') {
        const data = payload as { count: number };
        h.pendingCountChanged.send({ sessionId, count: data.count });
      } else if (event === 'sessionStateChanged') {
        const data = payload as { conversationId: string; running: boolean; pendingAction: boolean; paused: boolean };
        h.sessionStateChanged.send(data);
      } else if (event === 'sessionClosed') {
        const data = payload as { conversationId: string };
        h.sessionClosed.send(data);
      }
    } catch { /* 窗口已销毁，忽略 */ }
  }
});

const COMPLETE_BODY: Record<string, string> = {
  success: 'AI 已完成回复',
  failed: '会话执行失败，请查看详情',
};

async function handleSessionNotification(
  sessionId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  try {
    const convId = getPiSessionManager().getConversationIdBySession(sessionId);
    if (!convId) return;

    const lookup = await conversationService.getByIdGlobal(convId);
    if (!lookup || lookup.conv.role !== 'main') return;

    const service = getSessionNotificationService();

    if (event === 'complete') {
      // 过滤链：executor 任务轮静默；有 running 子会话（派子会话后的中间轮）静默；cancelled（手动停止）静默
      if (lookup.conv.executor) return;
      const children = await getChildrenByParent(convId);
      if (children.some((c) => c.status === 'running')) return;
      const result = payload as PiSessionTurnResult;
      if (result.subtype === 'cancelled') return;
      service.notify({
        kind: 'complete',
        notificationId: `${sessionId}-${Date.now()}`,
        conversationId: convId,
        workspaceId: lookup.workspaceId,
        title: lookup.conv.title || '会话',
        body: COMPLETE_BODY[result.subtype] ?? COMPLETE_BODY.success,
      });
      service.playCue(result.subtype === 'failed' ? 'error' : 'complete');
    } else if (event === 'permissionRequest') {
      const data = payload as { requestId: string; toolName: string; toolInput: unknown };
      service.notify({
        kind: 'permission',
        notificationId: data.requestId,
        conversationId: convId,
        workspaceId: lookup.workspaceId,
        title: lookup.conv.title || '会话',
        toolName: data.toolName,
      });
      service.playCue('permission');
    }
  } catch (err) {
    mainLogger.warn('[session-notification] 广播通知分支失败:', err);
  }
}

export const agentRouter = {
  // ── 旧版 Agent 任务 ──────────────────────────────────────
  submitTask: t.procedure
    .input<{ task: AgentTask }>()
    .action(async ({ input }) => {
      const agentManager = getAgentManager();
      const taskId = await agentManager.submitTask(input.task, (taskId, status, result, error) => {
        sendToDebugWindow('debug:taskUpdate', { taskId, status, result, error });
        if (result?.message) {
          sendToDebugWindow('debug:agentMessage', { role: 'assistant', content: result.message, timestamp: Date.now() });
        }
      });
      return { taskId };
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

  openStockWindow: t.procedure
    .action(async () => {
      const { createStockWindow } = await import('../main-app.js');
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
        const piSessionManager = getPiSessionManager();
        const activeSession = piSessionManager.getSession(input.sessionId);
        if (!activeSession) return { error: '会话不存在' };

        const convId = piSessionManager.getConversationIdBySession(input.sessionId);

        // 自动 title：如果对话的 title 仍是默认值"新对话"，用这条消息的前 30 字替换。
        // 只跑一次（后续消息 title 已不是默认值）。用户文本优先取 textBlocks 最后一个块（用户输入在引用之后），否则用 content。
        // 失败不影响发送流程，只记日志。
        if (convId) {
          try {
            const lookup = await conversationService.getByIdGlobal(convId);
            if (!lookup?.conv.groupId) return { error: '对话未关联话题，无法发送消息' };
            await requireActiveGroup(lookup.workspaceId, lookup.conv.groupId);
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
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
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
        // 使用 release 而非直接 close：引用计数归零才真正销毁（支持多持有者共享 session）
        await getPiSessionManager().release(input.sessionId);
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
        await getPiSessionManager().closeSession(input.sessionId);
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
        const session = getPiSessionManager().getSession(input.sessionId);
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
        const activeSession = getPiSessionManager().getSession(input.sessionId);
        if (!activeSession) return { error: '会话不存在' };
        await activeSession.interrupt();
        return { success: true };
      } catch (error) {
        console.error('中断会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 请求暂停：不打断当前 turn，完成后进入 paused（accepted=false 表示会话不在运行中） */
  pauseQueryBasedSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      try {
        const activeSession = getPiSessionManager().getSession(input.sessionId);
        if (!activeSession) return { error: '会话不存在' };
        const accepted = activeSession.requestPause();
        return { success: accepted };
      } catch (error) {
        console.error('请求暂停会话失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 更改权限模式 */
  setPermissionMode: t.procedure
    .input<{ sessionId: string; mode: PiPermissionMode }>()
    .action(async ({ input }) => {
      try {
        const activeSession = getPiSessionManager().getSession(input.sessionId);
        if (!activeSession) return { error: '会话不存在' };
        const piSessionManager = getPiSessionManager();
        const convId = piSessionManager.getConversationIdBySession(input.sessionId);
        if (convId) {
          const conv = await conversationService.getByIdGlobal(convId);
          if (conv?.conv.role === 'sub') return { error: '子会话权限模式固定为 autoExecute，不可更改' };
        }
        await activeSession.setPermissionMode(input.mode);
        return { success: true };
      } catch (error) {
        console.error('更改权限模式失败:', error);
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 响应权限确认请求（允许/本会话允许/拒绝） */
  respondPermissionRequest: t.procedure
    .input<{ sessionId: string; requestId: string; behavior: 'allow' | 'deny' | 'allow_session'; message?: string }>()
    .action(async ({ input }) => {
      try {
        const activeSession = getPiSessionManager().getSession(input.sessionId);
        if (!activeSession) return { error: '会话不存在' };
        activeSession.respondPermissionRequest(input.requestId, input.behavior, input.message);
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
        const session = getPiSessionManager().getSession(input.sessionId);
        if (!session) return { error: '会话不存在' };
        session.respondAskUserQuestion();
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
        const session = getPiSessionManager().getSession(input.sessionId);
        if (!session) {
          return { ok: false as const, error: 'session_not_found' };
        }
        return await session.setModel(input.selection);
      } catch (error) {
        console.error('切换会话模型失败:', error);
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // ── Harness 会话历史读取（以 Conversation 为入口）────────────
  /**
   * 通用会话历史 IPC：以 conversationId 为入口读取 Harness 当前 branch。
   * - empty：conversation 尚无 sessionId（新对话，从未发送过消息）
   * - ok：读取 Harness 当前 branch 并转换为前端消息格式
   */
  getConversationHistory: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conv = await conversationService.getById(input.workspaceId, input.conversationId);
        if (!conv) return { status: 'error' as const, error: '对话不存在' };

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

  // 获取所有已注册的工具元数据（遍历注册中心，调工厂提取 name/description）
  getRegisteredTools: t.procedure
    .action(async () => {
      await Promise.all([
        import('../agents/tools/memory-tools.js'),
        import('../agents/tools/article-tools.js'),
        import('../agents/tools/browser-tools.js'),
        import('../agents/tools/extension-tools.js'),
        import('../agents/tools/stock-tools.js'),
        import('../agents/tools/stock-analysis-tools.js'),
        import('../agents/tools/stock-announcement-tools.js'),
        import('../agents/tools/stock-picking-tools.js'),
        import('../agents/tools/group-tools.js'),
        import('../agents/tools/delegation-tools.js'),
        import('../agents/tools/reference-tools.js'),
      ]);
      const { getAllToolGroups } = await import('../agents/tools/tool-registry.js');
      return getAllToolGroups();
    }),

  // 获取可选工具包清单（含启用状态），供设置页 ToolPacksTab 使用
  listToolPacks: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      const { OPTIONAL_TOOL_PACKS } = await import('../services/tool-packs.js');
      const { getWorkspaceConfig } = await import('../services/workspace-config-service.js');
      const wsConfig = await getWorkspaceConfig(input.workspaceId);
      const enabled = new Set(wsConfig.enabledToolPacks);
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
      const { createSessionWindow } = await import('../main-app.js');
      createSessionWindow(input.conversationId, input.title);
      return { success: true };
    }),

};
