// electron/main/tipc/conversations.ts
import { tipc } from '@egoist/tipc/main';
import * as conversationService from '../services/conversation-service.js';

const t = tipc.create();

export const conversationsRouter = {
  getByBookId: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      try {
        const conversations = await conversationService.getByBookId(input.bookId);
        return { conversations: conversations.map(conversationService.toCompat), error: undefined };
      } catch (error) {
        console.error('获取对话列表失败:', error);
        return { conversations: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getById: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      try {
        const conversation = await conversationService.getById(input.conversationId);
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
        return { conversationId, error: undefined };
      } catch (error) {
        console.error('创建对话失败:', error);
        return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  updateTitle: t.procedure
    .input<{ conversationId: string; title: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateTitle(input.conversationId, input.title);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话标题失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  updateSdkSessionId: t.procedure
    .input<{ conversationId: string; sdkSessionId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateSdkSessionId(input.conversationId, input.sdkSessionId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新 SDK session ID 失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteConversation: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.deleteConversation(input.conversationId);
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
        return { conversationId, error: undefined };
      } catch (error) {
        console.error('创建分叉对话失败:', error);
        return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
