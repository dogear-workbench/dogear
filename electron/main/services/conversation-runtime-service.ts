import { v4 as uuidv4 } from 'uuid';
import { getPiSessionManager, type SessionCloseSource } from '../agents/pi-session/pi-session-manager.js';
import { PiSession } from '../agents/pi-session/pi-session.js';
// 0.99.2 删除了上游 SessionError，改用 session-history-reader 的本地同名类（code 语义兼容）
import { SessionError } from '../agents/pi-session/session-history-reader.js';
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { PiPermissionMode } from '../agents/pi-session/permission-mode.js';
import * as workspaceJsonService from './workspace-json-service.js';
import * as conversationService from './conversation-service.js';
import { recoverAlignedHarnessForConversation } from './session-id-repair.js';
import { requireActiveGroup } from './group-service.js';
import { loadSettings } from './settings-service.js';
import { getWorkspaceConfig } from './workspace-config-service.js';

export type RuntimeHolderType = 'desktop' | 'feishu-bot';

export interface ConversationRuntimeAttachment {
  attachmentId: string;
  sessionId: string;
  permissionMode: PiPermissionMode;
  created: boolean;
  /** 复用已有 session 时，当前 turn 的进行中消息快照（供晚加入的渲染层重播） */
  snapshot: ExtendedSessionMessage[];
  /** 快照对应 run 已落盘 entry 的 SessionTreeEntry.id 序列（与 snapshot 同生命周期） */
  turnEntryIds: string[];
  pendingPermissionRequests: Array<{
    requestId: string;
    toolName: string;
    toolInput: unknown;
  }>;
  sessionState: {
    running: boolean;
    pendingAction: boolean;
    paused: boolean;
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
  /** 明确装载的 skill 全集：执行会话按任务类型恒传查表清单（default 空清单=基础版）；undefined = 不覆盖跟随工作区 enabledSkills，保留给非执行场景 */
  skillsOverride?: readonly string[];
  /** 任务级工具包覆盖（定时任务 toolPacksOverride 映射）；undefined = 跟随工作区 enabledToolPacks */
  enabledToolPacksOverride?: string[];
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
    if (!conversation.groupId) throw new Error('对话未关联话题，无法启动运行时');
    await requireActiveGroup(workspaceId, conversation.groupId);

    const piSessionManager = getPiSessionManager();
    let sessionId = piSessionManager.getSessionIdByConversation(conversationId);
    let session = sessionId ? piSessionManager.getSession(sessionId) : undefined;
    let isRestore = !!conversation.sessionId;
    let created = false;

    if (sessionId && !session) {
      sessionId = undefined;
    }

    if (sessionId && session) {
      piSessionManager.retain(sessionId);
    } else {
      // sessionId 丢失防线：有历史轮次的会话不新建空壳 harness，先按时间对齐回填真实 id 走恢复
      let harnessSessionId = conversation.sessionId ?? null;
      if (!harnessSessionId) {
        const recovered = await recoverAlignedHarnessForConversation(workspaceId, conversation);
        if (recovered) {
          harnessSessionId = recovered;
          isRestore = true;
        }
      }
      const appSettings = await loadSettings();
      const wsConfig = await getWorkspaceConfig(workspaceId);
      const workspace = await workspaceJsonService.getById(workspaceId);
      const permissionMode: PiPermissionMode = conversation.role === 'sub'
        ? 'autoExecute'
        : appSettings.ai.permissionMode;
      session = await piSessionManager.createSession({
        conversationId,
        modelSelection: conversation.modelSelection ?? null,
        workspacePath: workspace?.path ?? '',
        additionalPaths: (workspace?.additionalPaths ?? []).filter((p) => p.enabled).map((p) => p.path),
        workspaceId,
        harnessSessionId,
        enabledToolPacks: options?.enabledToolPacksOverride ?? wsConfig.enabledToolPacks,
        skillsOverride: options?.skillsOverride,
        groupId: conversation.groupId || undefined,
        role: conversation.role ?? 'main',
        executor: conversation.executor,
        schedulerTask: conversation.schedulerTaskId != null,
        parentConversationId: conversation.parentConversationId ?? undefined,
        subAgent: conversation.role === 'sub'
          ? {
              task: conversation.contractMetadata?.task ?? '完成派出者交代的任务',
              outputPath: conversation.contractMetadata?.expectedOutputPath ?? '',
            }
          : undefined,
        permissionMode,
        basicToolPermissions: appSettings.basicToolPermissions,
        subAgentProfile: conversation.role === 'sub'
          ? (appSettings.subAgent?.profiles ?? []).find((p) => p.id === conversation.contractMetadata?.subAgentProfileId)
            ?? (appSettings.subAgent?.profiles ?? []).find((p) => p.id === 'default')
          : undefined,
      });
      try {
        await session.start();
      } catch (error) {
        // 撞上一轮销毁 close 未完成（repo openSessions 注册表尚未释放）的竞速：短退避重试一次；
        // start() 有 adapter 早退保护，首次失败时 adapter 仍为 null，重试仍走完整 open
        if (error instanceof Error && error.message.includes('Session is already open')) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          try {
            await session.start();
          } catch (retryError) {
            this.failSessionStart(session, isRestore, retryError);
          }
        } else {
          this.failSessionStart(session, isRestore, error);
        }
      }
      if (!isRestore) {
        await conversationService.updateSessionId(
          workspaceId,
          conversationId,
          session.getHarnessSessionId()!,
        );
      }
      sessionId = session.getSessionId();
      piSessionManager.bindConversation(conversationId, sessionId);
      created = !isRestore;
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
      turnEntryIds: liveSnapshot.turnEntryIds,
      pendingPermissionRequests: liveSnapshot.permissionRequests,
      sessionState: liveSnapshot.sessionState,
    };
  }

  /** start 失败统一收尾：关 session，仅历史文件真缺失/损坏时换文案（避免其他异常如模型配置问题被误标） */
  private failSessionStart(session: PiSession, isRestore: boolean, error: unknown): never {
    getPiSessionManager().closeSession(session.getSessionId());
    if (isRestore && error instanceof SessionError && (error.code === 'not_found' || error.code === 'invalid_session')) {
      throw new Error('会话历史文件缺失或损坏，无法恢复会话');
    }
    throw error;
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

  detachAttachment(attachmentId: string, source: SessionCloseSource = 'natural'): boolean {
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

    getPiSessionManager().release(meta.sessionId, source);
    return true;
  }

  /**
   * 按对话 + 持有者类型批量 detach（failover 重建 session 前让 desktop 引用归零销毁），
   * 返回清理数与首个匹配 attachment 的 webContentsId（供重建时透传窗口归属）
   */
  detachByConversationHolder(
    conversationId: string,
    holderType: RuntimeHolderType,
    source: SessionCloseSource = 'natural',
  ): { count: number; webContentsId?: number } {
    let count = 0;
    let webContentsId: number | undefined;
    for (const [attachmentId, meta] of this.attachmentMap) {
      if (meta.conversationId !== conversationId || meta.holderType !== holderType) continue;
      if (webContentsId === undefined) webContentsId = meta.webContentsId;
      this.detachAttachment(attachmentId, source);
      count++;
    }
    return { count, webContentsId };
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
