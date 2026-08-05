import { v4 as uuidv4 } from 'uuid';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { PiPermissionMode } from '../agents/pi-session/permission-mode.js';
import * as workspaceJsonService from './workspace-json-service.js';
import * as conversationService from './conversation-service.js';
import { loadSettings } from './settings-service.js';

export type RuntimeHolderType = 'desktop' | 'wechat-bot';

export interface ConversationRuntimeAttachment {
  attachmentId: string;
  sessionId: string;
  permissionMode: PiPermissionMode;
  created: boolean;
  /** 复用已有 session 时，当前 turn 的进行中消息快照（供晚加入的渲染层重播） */
  snapshot: ExtendedSessionMessage[];
  pendingPermissionRequests: Array<{
    requestId: string;
    toolName: string;
    toolInput: unknown;
  }>;
  sessionState: {
    running: boolean;
    pendingAction: boolean;
  };
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

type AttachConversationOptions = {
  webContentsId?: number;
};

class ConversationRuntimeService {
  private attachmentMap = new Map<string, AttachmentMeta>();
  private sessionAttachments = new Map<string, Set<string>>();

  /**
   * 所有非归档主会话统一交由 PiSessionManager 管理：有存活 session 就 retain，
   * 否则新建 + bind。SDK 主会话分流、resume/fork 逻辑已随 SDK 主会话移除删除
   * （旧 Conversation 已在启动迁移中归档，不会再走到这里）。
   */
  async attachConversation(
    conversationId: string,
    workspaceId: string,
    holderType: RuntimeHolderType,
    options?: AttachConversationOptions,
  ): Promise<ConversationRuntimeAttachment> {
    const conversation = await conversationService.getById(workspaceId, conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

    const piSessionManager = getPiSessionManager();
    let sessionId = piSessionManager.getSessionIdByConversation(conversationId);
    let session = sessionId ? piSessionManager.getSession(sessionId) : undefined;
    let created = false;

    if (sessionId && !session) {
      sessionId = undefined;
    }

    if (sessionId && session) {
      piSessionManager.retain(sessionId);
    } else {
      const appSettings = await loadSettings();
      const workspace = await workspaceJsonService.getById(workspaceId);
      const permissionMode = conversation.role === 'sub'
        ? appSettings.subAgent?.permissionMode ?? appSettings.ai.permissionMode
        : appSettings.ai.permissionMode;
      session = piSessionManager.createSession({
        conversationId,
        modelSelection: conversation.modelSelection ?? null,
        systemPrompt: appSettings.ai.defaultSystemPrompt,
        workspacePath: workspace?.path ?? '',
        workspaceId,
        harnessSessionId: conversation.sessionId ?? null,
        onHarnessSessionCreated: (harnessSessionId) =>
          Promise.all([
            conversationService.updateSessionId(workspaceId, conversationId, harnessSessionId),
            conversationService.updateSdkSessionId(workspaceId, conversationId, harnessSessionId),
          ]).then(() => undefined),
        enabledToolPacks: appSettings.enabledToolPacks ?? [],
        groupId: conversation.groupId || undefined,
        role: conversation.role ?? 'main',
        parentConversationId: conversation.parentConversationId ?? undefined,
        permissionMode,
      });
      try {
        await session.start();
      } catch (error) {
        // start() 失败（如 Harness session 文件缺失/损坏）时，createSession 已注册的
        // sessions/refCounts 条目从未 bindConversation，没有其他路径能回收，必须在这里主动清理。
        piSessionManager.closeSession(session.getSessionId());
        throw error;
      }
      sessionId = session.getSessionId();
      piSessionManager.bindConversation(conversationId, sessionId);
      created = true;
    }

    if (!sessionId || !session) {
      throw new Error(`Failed to attach runtime for conversation ${conversationId}`);
    }

    const attachmentId = uuidv4();
    this.attachmentMap.set(attachmentId, { sessionId, conversationId, holderType, webContentsId: options?.webContentsId });
    const attachments = this.sessionAttachments.get(sessionId) ?? new Set<string>();
    attachments.add(attachmentId);
    this.sessionAttachments.set(sessionId, attachments);

    const liveSnapshot = session.getLiveSnapshot();
    return {
      attachmentId,
      sessionId,
      permissionMode: session.getPermissionMode(),
      created,
      snapshot: liveSnapshot.messages,
      pendingPermissionRequests: liveSnapshot.permissionRequests,
      sessionState: liveSnapshot.sessionState,
    };
  }

  async closeConversation(conversationId: string): Promise<void> {
    const sessionIds = new Set<string>();
    for (const [attachmentId, meta] of this.attachmentMap) {
      if (meta.conversationId !== conversationId) continue;
      sessionIds.add(meta.sessionId);
      this.attachmentMap.delete(attachmentId);
      const attachments = this.sessionAttachments.get(meta.sessionId);
      if (!attachments) continue;
      attachments.delete(attachmentId);
      if (attachments.size === 0) this.sessionAttachments.delete(meta.sessionId);
    }

    const piSessionManager = getPiSessionManager();
    const activeSessionId = piSessionManager.getSessionIdByConversation(conversationId);
    if (activeSessionId) sessionIds.add(activeSessionId);
    for (const sessionId of sessionIds) {
      if (piSessionManager.getSession(sessionId)) {
        await piSessionManager.closeSession(sessionId);
      }
    }
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

    getPiSessionManager().release(meta.sessionId);
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
    const piSessionManager = getPiSessionManager();
    const sessionId = piSessionManager.getSessionIdByConversation(conversationId);
    if (!sessionId || !piSessionManager.getSession(sessionId)) {
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
