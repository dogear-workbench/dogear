/**
 * 对话相关 IPC 处理器
 * 处理对话和消息的增删查查相关的 IPC 请求
 */

import { ipcMain } from 'electron';
import {
  dbConversations,
  dbConversationMessages,
  dbBooks
} from '../database/index.js';
import type { Conversation, ConversationMessage } from '../database/index.js';

/**
 * 注册所有对话相关的 IPC 处理器
 */
export function registerConversationHandlers() {
  /**
   * 获取书籍的所有对话
   */
  ipcMain.handle('conversations:getByBookId', async (_, bookId: string) => {
    try {
      const conversations = dbConversations.getByBookId(bookId);
      return { conversations, error: undefined };
    } catch (error) {
      console.error('获取对话列表失败:', error);
      return { conversations: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 获取单个对话
   */
  ipcMain.handle('conversations:getById', async (_, conversationId: string) => {
    try {
      const conversation = dbConversations.getById(conversationId);
      return { conversation, error: undefined };
    } catch (error) {
      console.error('获取对话失败:', error);
      return { conversation: null, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 创建新对话
   */
  ipcMain.handle('conversations:create', async (_, bookId: string, title?: string) => {
    try {
      // 验证书籍是否存在
      const book = dbBooks.getById(bookId);
      if (!book) {
        return { conversationId: null, error: '书籍不存在' };
      }

      // 生成默认标题
      const defaultTitle = title || '新对话';

      const conversationId = dbConversations.create(bookId, defaultTitle);
      return { conversationId, error: undefined };
    } catch (error) {
      console.error('创建对话失败:', error);
      return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 更新对话标题
   */
  ipcMain.handle('conversations:updateTitle', async (_, conversationId: string, title: string) => {
    try {
      dbConversations.updateTitle(conversationId, title);
      return { success: true, error: undefined };
    } catch (error) {
      console.error('更新对话标题失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 删除对话
   */
  ipcMain.handle('conversations:delete', async (_, conversationId: string) => {
    try {
      dbConversations.delete(conversationId);
      return { success: true, error: undefined };
    } catch (error) {
      console.error('删除对话失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 获取对话的所有消息
   */
  ipcMain.handle('conversations:getMessages', async (_, conversationId: string) => {
    try {
      const messages = dbConversationMessages.getByConversationId(conversationId);
      return { messages, error: undefined };
    } catch (error) {
      console.error('获取消息列表失败:', error);
      return { messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 添加消息到对话
   */
  ipcMain.handle('conversations:addMessage', async (_, message: Omit<ConversationMessage, 'id'>) => {
    try {
      const messageId = dbConversationMessages.add(message);
      return { messageId, error: undefined };
    } catch (error) {
      console.error('添加消息失败:', error);
      return { messageId: null, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 批量添加消息（用于保存对话历史）
   */
  ipcMain.handle('conversations:addMessages', async (_, messages: Omit<ConversationMessage, 'id'>[]) => {
    try {
      dbConversationMessages.bulkAdd(messages);
      return { success: true, error: undefined };
    } catch (error) {
      console.error('批量添加消息失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 获取工作区中所有书籍及其对话
   * 用于构建图书-对话树形结构
   */
  ipcMain.handle('conversations:getBooksWithConversations', async (_, workspaceId?: string) => {
    try {
      // 获取所有书籍
      let books = dbBooks.getAll();

      // 如果指定了工作区，只返回该工作区的书籍
      if (workspaceId && workspaceId !== 'default') {
        books = books.filter(b => b.workspace_id === workspaceId);
      }

      // 获取每本书的对话
      const booksWithConversations = books.map(book => {
        const conversations = dbConversations.getByBookId(book.id!);
        return {
          book,
          conversations
        };
      });

      return { booksWithConversations, error: undefined };
    } catch (error) {
      console.error('获取书籍对话列表失败:', error);
      return { booksWithConversations: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
}
