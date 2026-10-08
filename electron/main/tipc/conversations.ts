// electron/main/tipc/conversations.ts
import { tipc } from '@egoist/tipc/main';
import * as conversationService from '../services/conversation-service.js';
import * as groupService from '../services/group-service.js';
import * as topicLifecycleService from '../services/topic-lifecycle-service.js';
import { moveConversationToWorkspace } from '../services/conversation-move-service.js';
import { getPiSessionRepository } from '../agents/pi-session/pi-session-repository.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import { loadSettings } from '../services/settings-service.js';

const t = tipc.create();

export const conversationsRouter = {
  // ── 对话 CRUD ─────────────────────────────────────────────

  getById: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conversation = await conversationService.getById(input.workspaceId, input.conversationId);
        return { conversation: conversation ?? null, error: undefined };
      } catch (error) {
        console.error('获取对话失败:', error);
        return { conversation: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  create: t.procedure
    .input<{ workspaceId: string; title?: string; groupId?: string }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        const title = input.title || '新对话';
        const groupId = input.groupId
          ?? (await groupService.createGroup(input.workspaceId, { title })).id;
        const conversationId = await conversationService.create(
          input.workspaceId,
          groupId,
          title,
          settings.ai.defaultModelSelection,
          { userInitiated: true },
        );
        return { conversationId, error: undefined };
      } catch (error) {
        console.error('创建对话失败:', error);
        return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  updateTitle: t.procedure
    .input<{ conversationId: string; title: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateTitle(input.workspaceId, input.conversationId, input.title);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话标题失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteConversation: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const result = await topicLifecycleService.deleteConversation(input.workspaceId, input.conversationId);
        return result.ok
          ? { success: true, error: undefined }
          : { success: false, error: result.error };
      } catch (error) {
        console.error('删除对话失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),


  // 获取工作区下所有对话（按 updatedAt 倒序）
  getByWorkspaceId: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conversations = await conversationService.getByWorkspaceId(input.workspaceId);
        return { conversations, error: undefined };
      } catch (error) {
        console.error('获取工作区对话列表失败:', error);
        return { conversations: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /**
   * 创建分叉对话：先用 Harness repository 同步 fork 出新 sessionId，成功后才落
   * Conversation metadata；metadata 落盘失败则回滚删除刚 fork 出的孤儿 session。
   * 第一版只支持"从可无歧义定位的 entry fork"——forkMessageSdkUuid 现在是前端消息
   * 携带的 Harness SessionTreeEntry id（分叉按钮只在助手消息上出现，history-adapter
   * 已把该消息合并写入的最后一个 entry id 塞进 sdkUuid），用 position:'at' 精确截断；
   * 拿不到时退化为拷贝父 session 全部 entries（等效于从当前 leaf fork）。
   */
  createFork: t.procedure
    .input<{ workspaceId: string; title: string; parentConversationId: string; forkMessageSdkUuid: string }>()
    .action(async ({ input }) => {
      try {
        const parent = await conversationService.getById(input.workspaceId, input.parentConversationId);
        if (!parent) return { conversationId: null, error: '父对话不存在' };
        if (!parent.sessionId) return { conversationId: null, error: '父对话尚未创建会话，无法分叉' };
        if (parent.groupId) await groupService.requireActiveGroup(input.workspaceId, parent.groupId);

        const repository = getPiSessionRepository();
        let forkedSessionId: string;
        try {
          const forkOptions = input.forkMessageSdkUuid
            ? { entryId: input.forkMessageSdkUuid, position: 'at' as const }
            : {};
          const { info } = await repository.fork(input.workspaceId, parent.sessionId, forkOptions);
          forkedSessionId = info.id;
        } catch (error) {
          console.error('[createFork] Harness fork 失败:', error);
          return { conversationId: null, error: `分叉会话失败: ${error instanceof Error ? error.message : String(error)}` };
        }

        // fork 继承父对话的 groupId；父对话无 groupId 时（理论上迁移后不存在）新建一组
        const groupId = parent.groupId
          ?? (await groupService.createGroup(input.workspaceId, { title: input.title })).id;

        try {
          const conversationId = await conversationService.createFork(
            input.workspaceId,
            groupId,
            input.title,
            input.parentConversationId,
            forkedSessionId,
            input.forkMessageSdkUuid,
            parent.modelSelection ?? null,
          );
          return { conversationId, error: undefined };
        } catch (error) {
          console.error('[createFork] 创建 Conversation metadata 失败，回滚孤儿 session:', error);
          try {
            await repository.delete(input.workspaceId, forkedSessionId);
          } catch (cleanupError) {
            console.error('[createFork] 孤儿 session 清理失败，需人工检查残留文件:', {
              workspaceId: input.workspaceId,
              forkedSessionId,
              cleanupError,
            });
          }
          return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
        }
      } catch (error) {
        console.error('创建分叉对话失败:', error);
        return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  setConversationModelSelection: t.procedure
    .input<{ workspaceId: string; conversationId: string; selection: import('../services/settings-types.js').ModelSelection | null }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateModelSelection(
          input.workspaceId,
          input.conversationId,
          input.selection,
        );
        const sessionId = getPiSessionManager().getSessionIdByConversation(input.conversationId);
        const session = sessionId ? getPiSessionManager().getSession(sessionId) : undefined;
        if (session) session.updateModelSelection(input.selection);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话模型选择失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 翻转会话未读标记（入参只带 conversationId，workspaceId 由服务层全局定位；值未变化时服务层 no-op） */
  setUnread: t.procedure
    .input<{ conversationId: string; unread: boolean }>()
    .action(async ({ input }) => {
      try {
        await conversationService.setUnread(input.conversationId, input.unread);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新未读标记失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 把临时会话（personal）移入真实工作区：索引迁移 + session JSONL 搬运 + personal 侧清理 */
  moveConversationToWorkspace: t.procedure
    .input<{ conversationId: string; targetWorkspaceId: string; targetGroupId?: string; newGroupTitle?: string }>()
    .action(async ({ input }) => {
      try {
        const result = await moveConversationToWorkspace(input);
        return result.ok
          ? { ok: true, conversationId: result.conversationId, groupId: result.groupId, error: undefined }
          : { ok: false, conversationId: null, groupId: null, error: result.error };
      } catch (error) {
        console.error('移入工作区失败:', error);
        return { ok: false, conversationId: null, groupId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // ── 跨工作区查找 ──────────────────────────────────────────

  /** 通过 conversationId 全局查找对话及其所属工作区（独立窗口初始化用） */
  getConversationWithWorkspace: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      try {
        const result = await conversationService.getByIdGlobal(input.conversationId);
        if (!result) return { conversation: null, workspaceId: null };
        return {
          conversation: result.conv,
          workspaceId: result.workspaceId,
        };
      } catch (error) {
        console.error('跨工作区查找对话失败:', error);
        return { conversation: null, workspaceId: null };
      }
    }),
};
