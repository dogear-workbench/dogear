import { v4 as uuidv4 } from 'uuid';
import electron from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { getQueryBasedSessionManager } from '../agents/query-based-session.js';
import type { QueryBasedSession, QueryBasedSessionConfig, ExtendedSessionMessage } from '../agents/query-based-session.js';
import { createArticleTools } from '../agents/tools/article-tools.js';
import { createStockTools } from '../agents/tools/stock-tools.js';
import { createMemoryTools } from '../agents/tools/memory-tools.js';
import { createStockAnalysisTools } from '../agents/tools/stock-analysis-tools.js';
import { loadWorkspaceAgents } from './agent-definition-service.js';
import * as workspaceJsonService from './workspace-json-service.js';
import * as conversationService from './conversation-service.js';
import { loadSettings } from './settings-service.js';
import { OPTIONAL_TOOL_PACKS } from './tool-packs.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';

const { BrowserWindow, Notification: ElectronNotification } = electron;

export type RuntimeHolderType = 'desktop' | 'wechat-bot';

export interface ConversationRuntimeAttachment {
  attachmentId: string;
  sessionId: string;
  permissionMode: string;
  created: boolean;
  /** 复用已有 session 时，当前 turn 的进行中消息快照（供晚加入的渲染层重播） */
  snapshot: ExtendedSessionMessage[];
}

export interface ConversationRuntimeState {
  conversationId: string;
  sessionId: string | null;
  attachmentCount: number;
  holders: RuntimeHolderType[];
}

type AttachmentMeta = {
  sessionId: string;
  conversationId: string;
  holderType: RuntimeHolderType;
  webContentsId?: number; // Electron webContents ID，用于窗口关闭时主动 detach
};

type WireOptions = {
  conversationId: string;
  workspaceId: string;
  clearForkFields?: boolean;
  forkSession?: boolean;
};

type AttachConversationOptions = {
  webContentsId?: number;
  clearForkFields?: boolean;
  resume?: string;
  forkSession?: boolean;
  resumeSessionAt?: string;
};

function broadcastToAll(
  fn: (handlers: ReturnType<typeof getRendererHandlers<RendererHandlers>>) => void,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      fn(getRendererHandlers<RendererHandlers>(win.webContents));
    } catch {
      // Ignore destroyed or unavailable windows.
    }
  }
}

async function buildConversationSessionConfig(
  conversationId: string,
  workspaceId: string,
  options?: AttachConversationOptions,
): Promise<QueryBasedSessionConfig> {
  const conversation = await conversationService.getById(workspaceId, conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const workspace = await workspaceJsonService.getById(workspaceId);
  const workspacePath = workspace?.path ?? '';

  const appSettings = await loadSettings();
  const enabledToolPacks = appSettings.enabledToolPacks ?? [];

  // 1. 常驻 MCP server（永远注册）：memory 工具
  // 2. 可选 MCP server（按 enabledToolPacks 注册）：article / stock-quote / stock-analysis
  const mcpServers: Record<string, unknown> = {};

  if (workspacePath) {
    mcpServers['dogear-memory'] = createMemoryTools(workspacePath);
  }

  // 工具包工厂表（避免遍历时分支判断）
  type ToolPackFactory = () => unknown;
  const toolPackFactories: Record<string, { factory: ToolPackFactory; available: boolean }> = {
    'article': {
      factory: () => createArticleTools(workspacePath),
      available: !!workspacePath,
    },
    'stock-quote': {
      factory: () => createStockTools(),
      available: true,
    },
    'stock-analysis': {
      factory: () => createStockAnalysisTools(),
      available: true,
    },
  };

  for (const pack of OPTIONAL_TOOL_PACKS) {
    if (!enabledToolPacks.includes(pack.name)) continue;
    const entry = toolPackFactories[pack.name];
    if (!entry || !entry.available) continue;
    mcpServers[pack.mcpServerName] = entry.factory();
  }

  // allowedTools：基础工具 + 常驻 MCP 通配符 + 已启用工具包通配符（默认放行 = 不弹权限）
  const allowedTools: string[] = ['Read', 'Glob', 'Grep', 'Agent'];
  if (mcpServers['dogear-memory']) {
    allowedTools.push('mcp__dogear-memory__*');
  }
  // 复盘工具（dogear-memory-review）由 query-based-session 在工作区上下文齐全时挂载，
  // 这里同条件放行，避免复盘 skill 每次调工具都弹权限
  if (workspacePath) {
    allowedTools.push('mcp__dogear-memory-review__*');
  }
  if (conversation.groupId) {
    allowedTools.push('mcp__dogear-group__*');
  }
  for (const pack of OPTIONAL_TOOL_PACKS) {
    if (mcpServers[pack.mcpServerName]) {
      allowedTools.push(`mcp__${pack.mcpServerName}__*`);
    }
  }

  // SKILL.md 插件：保留 article-parser 一条；stock-analysis 改为订阅到 <ws>/.claude/skills/，
  // 由 SDK settingSources=['project'] 自动加载，不再走 extraPluginPaths。
  const extraPluginPaths: string[] = [];

  const agents: Record<string, any> = {};

  // workspace 代理（订阅到 <ws>/.claude/agents/ 的副本由此处加载）
  if (workspacePath) {
    try {
      const fileAgents = await loadWorkspaceAgents(workspacePath);
      for (const fileAgent of fileAgents) {
        agents[fileAgent.agentName] = fileAgent.definition;
      }
    } catch (error) {
      console.warn('Failed to load workspace agents for runtime session:', error);
    }
  }

  return {
    allowedTools,
    workspacePath,
    workspaceId,
    groupId: conversation.groupId || undefined,
    enableSkills: true,
    extraPluginPaths: extraPluginPaths.length > 0 ? extraPluginPaths : undefined,
    mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
    enabledToolPacks: enabledToolPacks.length > 0 ? enabledToolPacks : undefined,
    resume: options?.resume ?? conversation.sdkSessionId ?? undefined,
    forkSession: options?.forkSession,
    resumeSessionAt: options?.resumeSessionAt,
    agents: Object.keys(agents).length > 0 ? agents : undefined,
    personaId: conversation.personaId,
    tempPrompt: conversation.tempPrompt,
    modelSelection: conversation.modelSelection ?? null,
    cachePolicy: conversation.cachePolicy ?? '5m',
    // 传入对话标题，新建 SDK 会话时跳过自动生成（resume 场景 SDK 内部忽略此字段）
    title: conversation.title,
    conversationId,
  };
}

function wireConversationSession(session: QueryBasedSession, options: WireOptions): void {
  session.on('session_init', async (data: { session_id: string }) => {
    try {
      await conversationService.updateSdkSessionId(
        options.workspaceId,
        options.conversationId,
        data.session_id,
      );
      if (options.clearForkFields || options.forkSession) {
        await conversationService.clearForkFields(options.workspaceId, options.conversationId);
      }
    } catch (error) {
      console.warn('Failed to persist sdk_session_id for runtime session:', error);
    }
  });

  session.on('session_capabilities', async (data: {
    tools: string[];
    skills: string[];
    mcpServers: Array<{ name: string; status: string }>;
  }) => {
    const sdkCommands = await session.getSupportedCommands();
    broadcastToAll((handlers) => handlers.sessionCapabilities.send({
      sessionId: session.getSessionId(),
      sdkCommands,
      tools: data.tools,
      skills: data.skills,
      mcpServers: data.mcpServers,
    }));
  });

  session.on('permissionRequest', (data: {
    requestId: string;
    toolName: string;
    toolInput: unknown;
    decisionReason?: string;
  }) => {
    broadcastToAll((handlers) => handlers.permissionRequest.send({
      sessionId: session.getSessionId(),
      requestId: data.requestId,
      toolName: data.toolName,
      toolInput: data.toolInput,
      decisionReason: data.decisionReason,
    }));
  });

  session.on('askUserQuestion', (data: { requestId: string; questions: any[] }) => {
    broadcastToAll((handlers) => handlers.askUserQuestion.send({
      sessionId: session.getSessionId(),
      requestId: data.requestId,
      questions: data.questions,
    }));
  });

  session.on('notification', (data: { title?: string; message: string; notificationType: string }) => {
    broadcastToAll((handlers) => handlers.agentNotification.send({
      sessionId: session.getSessionId(),
      title: data.title,
      message: data.message,
      notificationType: data.notificationType,
    }));
    if (ElectronNotification.isSupported()) {
      new ElectronNotification({
        title: data.title || 'Dogear',
        body: data.message,
      }).show();
    }
  });

  session.on('permissionModeChanged', (data: { mode: string }) => {
    broadcastToAll((handlers) => handlers.permissionModeChanged.send({
      sessionId: session.getSessionId(),
      mode: data.mode,
    }));
  });

  session.on('pendingCountChanged', (data: { count: number }) => {
    broadcastToAll((handlers) => handlers.pendingCountChanged.send({
      sessionId: session.getSessionId(),
      count: data.count,
    }));
  });

  session.on('subAgentStarted', (data: {
    parentSessionId: string;
    agentId: string;
    description: string;
    subagentType?: string;
  }) => {
    broadcastToAll((handlers) => handlers.subAgentStarted.send(data));
  });

  session.on('subAgentCompleted', (data: {
    parentSessionId: string;
    agentId: string;
    status: string;
    durationMs?: number;
    tokens?: number;
    toolUseCount?: number;
    resultText?: string;
  }) => {
    broadcastToAll((handlers) => handlers.subAgentCompleted.send(data));
  });

  setTimeout(async () => {
    try {
      const sdkCommands = await session.getSupportedCommands();
      if (sdkCommands.length > 0) {
        broadcastToAll((handlers) => handlers.sessionCapabilities.send({
          sessionId: session.getSessionId(),
          sdkCommands,
          tools: [],
          skills: [],
          mcpServers: [],
        }));
      }
    } catch (error) {
      console.warn('Failed to fetch session capabilities during runtime init:', error);
    }
  }, 100);
}

class ConversationRuntimeService {
  private attachmentMap = new Map<string, AttachmentMeta>();
  private sessionAttachments = new Map<string, Set<string>>();

  async attachConversation(
    conversationId: string,
    workspaceId: string,
    holderType: RuntimeHolderType,
    options?: AttachConversationOptions,
  ): Promise<ConversationRuntimeAttachment> {
    const sessionManager = getQueryBasedSessionManager();
    let sessionId = sessionManager.getSessionIdByConversation(conversationId);
    let session = sessionId ? sessionManager.getSession(sessionId) : undefined;
    let created = false;

    if (sessionId && !session) {
      sessionId = undefined;
    }

    if (sessionId && session && !options?.forkSession) {
      sessionManager.retain(sessionId);
    } else {
      // The conversation owns the runtime. Attachments only decide how to enter it.
      const sessionConfig = await buildConversationSessionConfig(conversationId, workspaceId, options);
      session = sessionManager.createSession(sessionConfig);
      await session.start();
      sessionId = session.getSessionId();
      sessionManager.bindConversation(conversationId, sessionId);
      wireConversationSession(session, {
        conversationId,
        workspaceId,
        clearForkFields: options?.clearForkFields,
        forkSession: options?.forkSession,
      });
      created = true;
    }

    if (!sessionId || !session) {
      throw new Error(`Failed to attach runtime for conversation ${conversationId}`);
    }

    if (holderType === 'wechat-bot' && created) {
      await session.setPermissionMode('bypassPermissions');
    }

    const attachmentId = uuidv4();
    this.attachmentMap.set(attachmentId, { sessionId, conversationId, holderType, webContentsId: options?.webContentsId });
    const attachments = this.sessionAttachments.get(sessionId) ?? new Set<string>();
    attachments.add(attachmentId);
    this.sessionAttachments.set(sessionId, attachments);

    // 复用已有 session 时，采集当前 turn 的进行中消息快照，供晚加入的渲染层重播
    const snapshot: ExtendedSessionMessage[] = created ? [] : session.getCurrentTurnSnapshot();

    return {
      attachmentId,
      sessionId,
      permissionMode: session.getPermissionMode(),
      created,
      snapshot,
    };
  }

  getAttachmentMeta(attachmentId: string): AttachmentMeta | undefined {
    return this.attachmentMap.get(attachmentId);
  }

  detachAttachment(attachmentId: string): boolean {
    const meta = this.attachmentMap.get(attachmentId);
    if (!meta) return false;

    this.attachmentMap.delete(attachmentId);
    const attachments = this.sessionAttachments.get(meta.sessionId);
    if (attachments) {
      attachments.delete(attachmentId);
      if (attachments.size === 0) {
        this.sessionAttachments.delete(meta.sessionId);
      }
    }

    getQueryBasedSessionManager().release(meta.sessionId);
    return true;
  }

  /**
   * 按 webContentsId 批量 detach（窗口关闭时主进程主动调用，避免渲染进程 cleanup 不可靠）
   */
  detachByWebContentsId(webContentsId: number): number {
    let count = 0;
    for (const [attachmentId, meta] of this.attachmentMap) {
      if (meta.webContentsId === webContentsId) {
        this.detachAttachment(attachmentId);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[ConvRuntime] detachByWebContentsId(${webContentsId}): 清理了 ${count} 个 attachment`);
    }
    return count;
  }

  getRuntimeByConversation(conversationId: string): ConversationRuntimeState {
    const sessionManager = getQueryBasedSessionManager();
    const sessionId = sessionManager.getSessionIdByConversation(conversationId);
    if (!sessionId || !sessionManager.getSession(sessionId)) {
      return {
        conversationId,
        sessionId: null,
        attachmentCount: 0,
        holders: [],
      };
    }

    const attachments = this.sessionAttachments.get(sessionId) ?? new Set<string>();
    const holders = Array.from(attachments)
      .map((attachmentId) => this.attachmentMap.get(attachmentId)?.holderType)
      .filter((holderType): holderType is RuntimeHolderType => !!holderType);

    return {
      conversationId,
      sessionId,
      attachmentCount: attachments.size,
      holders,
    };
  }

  getAttachmentSessionId(attachmentId: string): string | null {
    return this.attachmentMap.get(attachmentId)?.sessionId ?? null;
  }
}

export const conversationRuntimeService = new ConversationRuntimeService();


