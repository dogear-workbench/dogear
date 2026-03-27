// electron/main/tipc/conversations.ts
import { tipc } from '@egoist/tipc/main';
import * as conversationService from '../services/conversation-service.js';
import * as treeService from '../services/conversation-tree-service.js';

const t = tipc.create();

export const conversationsRouter = {
  // ── 对话 CRUD ─────────────────────────────────────────────

  getByBookId: t.procedure
    .input<{ bookId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conversations = await conversationService.getByBookId(input.workspaceId, input.bookId);
        return { conversations: conversations.map(conversationService.toCompat), error: undefined };
      } catch (error) {
        console.error('获取对话列表失败:', error);
        return { conversations: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

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
    .input<{ workspaceId: string; bookId?: string; title?: string }>()
    .action(async ({ input }) => {
      try {
        const conversationId = await conversationService.create(
          input.workspaceId,
          input.title || '新对话',
          input.bookId
        );
        // 同步添加到树
        await treeService.addConversationToTree(input.workspaceId, conversationId);
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

  updateSdkSessionId: t.procedure
    .input<{ conversationId: string; sdkSessionId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateSdkSessionId(input.workspaceId, input.conversationId, input.sdkSessionId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新 SDK session ID 失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteConversation: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.deleteConversation(input.workspaceId, input.conversationId);
        // 同步从树中移除
        await treeService.removeConversationFromTree(input.workspaceId, input.conversationId);
        return { success: true, error: undefined };
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
        return { conversations: conversations.map(conversationService.toCompat), error: undefined };
      } catch (error) {
        console.error('获取工作区对话列表失败:', error);
        return { conversations: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  createFork: t.procedure
    .input<{ workspaceId: string; title: string; parentConversationId: string; forkMessageSdkUuid: string; bookId?: string }>()
    .action(async ({ input }) => {
      try {
        const conversationId = await conversationService.createFork(
          input.workspaceId,
          input.title,
          input.parentConversationId,
          input.forkMessageSdkUuid,
          input.bookId
        );
        // 同步添加到树
        await treeService.addConversationToTree(input.workspaceId, conversationId);
        return { conversationId, error: undefined };
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

  // ── 对话树操作 ────────────────────────────────────────────

  getConversationTree: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const tree = await treeService.getTree(input.workspaceId);
        return { tree, error: undefined };
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
        return { success: true, error: undefined };
      } catch (error) {
        console.error('移动对话项目失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
