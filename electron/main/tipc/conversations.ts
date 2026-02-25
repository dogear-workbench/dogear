// electron/main/tipc/conversations.ts
import { tipc } from '@egoist/tipc/main';
import {
  dbConversations,
  dbConversationMessages,
  dbConversationBranches,
  dbBranchMessages,
  dbBooks,
} from '../database/index.js';
import type { ConversationMessage, BranchMessage } from '../database/index.js';

const t = tipc.create();

export const conversationsRouter = {
  getByBookId: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      try {
        const conversations = dbConversations.getByBookId(input.bookId);
        return { conversations, error: undefined };
      } catch (error) {
        console.error('获取对话列表失败:', error);
        return { conversations: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getById: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      try {
        const conversation = dbConversations.getById(input.conversationId);
        return { conversation, error: undefined };
      } catch (error) {
        console.error('获取对话失败:', error);
        return { conversation: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  create: t.procedure
    .input<{ bookId: string; title?: string }>()
    .action(async ({ input }) => {
      try {
        const book = dbBooks.getById(input.bookId);
        if (!book) return { conversationId: null, error: '书籍不存在' };
        const conversationId = dbConversations.create(input.bookId, input.title || '新对话');
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
        dbConversations.updateTitle(input.conversationId, input.title);
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
        dbConversations.updateSdkSessionId(input.conversationId, input.sdkSessionId);
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
        dbConversations.delete(input.conversationId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('删除对话失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getMessages: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      try {
        const messages = dbConversationMessages.getByConversationId(input.conversationId);
        return { messages, error: undefined };
      } catch (error) {
        console.error('获取消息列表失败:', error);
        return { messages: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  addMessage: t.procedure
    .input<{ message: Omit<ConversationMessage, 'id'> }>()
    .action(async ({ input }) => {
      try {
        const messageId = dbConversationMessages.add(input.message);
        return { messageId, error: undefined };
      } catch (error) {
        console.error('添加消息失败:', error);
        return { messageId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  addMessages: t.procedure
    .input<{ messages: Omit<ConversationMessage, 'id'>[] }>()
    .action(async ({ input }) => {
      try {
        dbConversationMessages.bulkAdd(input.messages);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('批量添加消息失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getBooksWithConversations: t.procedure
    .input<{ workspaceId?: string }>()
    .action(async ({ input }) => {
      try {
        let books = dbBooks.getAll();
        if (input.workspaceId && input.workspaceId !== 'default') {
          books = books.filter(b => b.workspace_id === input.workspaceId);
        }
        const booksWithConversations = books.map(book => ({
          book,
          conversations: dbConversations.getByBookId(book.id!),
        }));
        return { booksWithConversations, error: undefined };
      } catch (error) {
        console.error('获取书籍对话列表失败:', error);
        return { booksWithConversations: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  createFork: t.procedure
    .input<{ bookId: string; title: string; parentConversationId: string; forkMessageSdkUuid: string }>()
    .action(async ({ input }) => {
      try {
        const book = dbBooks.getById(input.bookId);
        if (!book) return { conversationId: null, error: '书籍不存在' };
        const conversationId = dbConversations.createFork(
          input.bookId, input.title, input.parentConversationId, input.forkMessageSdkUuid
        );
        return { conversationId, error: undefined };
      } catch (error) {
        console.error('创建分叉对话失败:', error);
        return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  createBranch: t.procedure
    .input<{ conversationId: string; forkPointSdkUuid: string; sdkSessionId: string }>()
    .action(async ({ input }) => {
      try {
        const branchIndex = dbConversationBranches.getNextBranchIndex(
          input.conversationId, input.forkPointSdkUuid
        );
        const branchId = dbConversationBranches.create(
          input.conversationId, input.forkPointSdkUuid, branchIndex, input.sdkSessionId
        );
        return { branchId, branchIndex, error: undefined };
      } catch (error) {
        console.error('创建分支失败:', error);
        return { branchId: null, branchIndex: -1, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getBranches: t.procedure
    .input<{ conversationId: string; forkPointSdkUuid?: string }>()
    .action(async ({ input }) => {
      try {
        const branches = input.forkPointSdkUuid
          ? dbConversationBranches.getByConversationAndForkPoint(input.conversationId, input.forkPointSdkUuid)
          : dbConversationBranches.getByConversationId(input.conversationId);
        return { branches, error: undefined };
      } catch (error) {
        console.error('获取分支列表失败:', error);
        return { branches: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getBranchMessages: t.procedure
    .input<{ branchId: string }>()
    .action(async ({ input }) => {
      try {
        const messages = dbBranchMessages.getByBranchId(input.branchId);
        return { messages, error: undefined };
      } catch (error) {
        console.error('获取分支消息失败:', error);
        return { messages: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  addBranchMessage: t.procedure
    .input<{ message: Omit<BranchMessage, 'id'> }>()
    .action(async ({ input }) => {
      try {
        const messageId = dbBranchMessages.add(input.message);
        return { messageId, error: undefined };
      } catch (error) {
        console.error('添加分支消息失败:', error);
        return { messageId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
