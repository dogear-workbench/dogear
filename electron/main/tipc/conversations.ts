// electron/main/tipc/conversations.ts
import { tipc } from '@egoist/tipc/main';
import * as conversationService from '../services/conversation-service.js';
import * as treeService from '../services/conversation-tree-service.js';
import * as groupService from '../services/group-service.js';
import * as topicLifecycleService from '../services/topic-lifecycle-service.js';
import { getPiSessionRepository } from '../agents/pi-session/pi-session-repository.js';
import { loadSettings } from '../services/settings-service.js';

const t = tipc.create();

/**
 * 拉取工作区所有 group 的 updatedAt，按倒序重排树。
 * 失败静默：对话本身写入已成功，重排只是 UX 优化。
 */
async function reorderTreeByUpdatedAt(workspaceId: string): Promise<void> {
  try {
    const groups = await groupService.listActiveGroups(workspaceId);
    const map: Record<string, number> = {};
    for (const g of groups) map[g.id] = g.updatedAt;
    await treeService.sortGroupsByUpdatedAt(workspaceId, map);
  } catch (error) {
    console.warn('[reorderTree] 重排对话树失败:', error);
  }
}

export const conversationsRouter = {
  // ── 对话 CRUD ─────────────────────────────────────────────

  getById: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conversation = await conversationService.getById(input.workspaceId, input.conversationId);
        return { conversation: conversation ? conversationService.toCompat(conversation) : null, error: undefined };
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
        // 顺手把树按 updatedAt 重排一次，让"同层时间倒序"自动收敛
        await reorderTreeByUpdatedAt(input.workspaceId);
        return { conversations: conversations.map(conversationService.toCompat), error: undefined };
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
            parent.cachePolicy ?? '5m',
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

  updateConversationPersona: t.procedure
    .input<{ workspaceId: string; conversationId: string; personaId?: string; tempPrompt?: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updatePersona(
          input.workspaceId,
          input.conversationId,
          input.personaId,
          input.tempPrompt,
        );
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话人设失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
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
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话模型选择失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  setConversationCachePolicy: t.procedure
    .input<{ workspaceId: string; conversationId: string; policy: '5m' | '1h' }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateCachePolicy(
          input.workspaceId,
          input.conversationId,
          input.policy,
        );
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话缓存策略失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
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
          conversation: conversationService.toCompat(result.conv),
          workspaceId: result.workspaceId,
        };
      } catch (error) {
        console.error('跨工作区查找对话失败:', error);
        return { conversation: null, workspaceId: null };
      }
    }),

  // ── 对话树操作 ────────────────────────────────────────────

  getConversationTree: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const tree = await treeService.getTree(input.workspaceId);
        const activeGroupIds = new Set(
          (await groupService.listActiveGroups(input.workspaceId)).map((group) => group.id),
        );
        const filteredChildren: Record<string, string[]> = {};
        for (const [parentId, childIds] of Object.entries(tree.children)) {
          filteredChildren[parentId] = childIds.filter((id) => tree.folders[id] || activeGroupIds.has(id));
        }
        const filtered = { ...tree, children: filteredChildren };
        return { tree: filtered, error: undefined };
      } catch (error) {
        console.error('获取对话树失败:', error);
        return { tree: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  createConversationFolder: t.procedure
    .input<{ workspaceId: string; name: string; parentId?: string }>()
    .action(async ({ input }) => {
      try {
        const folderId = await treeService.createFolder(input.workspaceId, input.name, input.parentId);
        return { folderId, error: undefined };
      } catch (error) {
        console.error('创建对话文件夹失败:', error);
        return { folderId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  renameConversationFolder: t.procedure
    .input<{ workspaceId: string; folderId: string; name: string }>()
    .action(async ({ input }) => {
      try {
        await treeService.renameFolder(input.workspaceId, input.folderId, input.name);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('重命名对话文件夹失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteConversationFolder: t.procedure
    .input<{ workspaceId: string; folderId: string }>()
    .action(async ({ input }) => {
      try {
        await treeService.deleteFolder(input.workspaceId, input.folderId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('删除对话文件夹失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  moveConversationItem: t.procedure
    .input<{ workspaceId: string; itemId: string; targetParentId: string; targetIndex?: number }>()
    .action(async ({ input }) => {
      try {
        await treeService.moveItem(input.workspaceId, input.itemId, input.targetParentId, input.targetIndex);
        // 移动后按时间倒序重排目标 parent，让对话自动落到顶端
        await reorderTreeByUpdatedAt(input.workspaceId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('移动对话项目失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  addGroupToFolder: t.procedure
    .input<{ workspaceId: string; groupId: string; folderId: string }>()
    .action(async ({ input }) => {
      try {
        await groupService.requireActiveGroup(input.workspaceId, input.groupId);
        await treeService.addGroupToFolder(input.workspaceId, input.groupId, input.folderId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('添加组到文件夹失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  removeGroupFromFolder: t.procedure
    .input<{ workspaceId: string; groupId: string; folderId: string }>()
    .action(async ({ input }) => {
      try {
        await groupService.requireActiveGroup(input.workspaceId, input.groupId);
        await treeService.removeGroupFromFolder(input.workspaceId, input.groupId, input.folderId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('从文件夹移除组失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  moveGroupBetweenFolders: t.procedure
    .input<{ workspaceId: string; groupId: string; fromFolderId: string; toFolderId: string }>()
    .action(async ({ input }) => {
      try {
        await groupService.requireActiveGroup(input.workspaceId, input.groupId);
        await treeService.moveGroupBetweenFolders(
          input.workspaceId, input.groupId, input.fromFolderId, input.toFolderId,
        );
        return { success: true, error: undefined };
      } catch (error) {
        console.error('在文件夹间移动组失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
