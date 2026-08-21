import { create } from 'zustand';
import type { ArticleMeta, QuoteSnippet } from '@/types/article';

/** 文件/文件夹引用 */
export interface FileReference {
  name: string;      // 文件名或文件夹名
  path: string;      // 绝对路径
  type?: 'file' | 'folder';  // 默认 'file'
}

/** 会话引用 */
export interface ConversationReference {
  conversationId: string;
  title: string;
  sessionId: string | null;
  workspaceId: string;
}

/** 共享文件引用（会话组共享区） */
export interface SharedFileReference {
  groupId: string;
  relPath: string;
  absPath: string;
}

interface ReferenceState {
  // --- 状态 ---
  referencedArticles: ArticleMeta[];
  quotedSnippets: QuoteSnippet[];
  referencedFiles: FileReference[];
  referencedConversations: ConversationReference[];
  referencedSharedFiles: SharedFileReference[];

  // --- Actions ---
  /** 引用/取消引用文章 */
  toggleReferenceArticle: (article: ArticleMeta) => void;
  /** 移除单篇引用文章 */
  removeReferencedArticle: (articleId: string) => void;
  /** 清空所有引用文章 */
  clearReferencedArticles: () => void;
  /** 添加引用片段 */
  addQuotedSnippet: (params: { articleId: string; articleTitle: string; text: string }) => void;
  /** 移除单条引用片段 */
  removeQuotedSnippet: (snippetId: string) => void;
  /** 清空所有引用片段 */
  clearQuotedSnippets: () => void;
  /** 添加文件引用 */
  addReferencedFile: (file: FileReference) => void;
  /** 移除文件引用 */
  removeReferencedFile: (filePath: string) => void;
  /** 清空所有文件引用 */
  clearReferencedFiles: () => void;
  /** 添加会话引用（去重） */
  addReferencedConversation: (conv: ConversationReference) => void;
  /** 移除会话引用 */
  removeReferencedConversation: (conversationId: string) => void;
  /** 清空所有会话引用 */
  clearReferencedConversations: () => void;
  /** 添加共享文件引用（去重） */
  addReferencedSharedFile: (file: SharedFileReference) => void;
  /** 移除共享文件引用 */
  removeReferencedSharedFile: (absPath: string) => void;
  /** 清空所有共享文件引用 */
  clearReferencedSharedFiles: () => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

export const useReferenceStore = create<ReferenceState>((set) => ({
  referencedArticles: [],
  quotedSnippets: [],
  referencedFiles: [],
  referencedConversations: [],
  referencedSharedFiles: [],

  toggleReferenceArticle: (article) => {
    set((state) => {
      const exists = state.referencedArticles.some((a) => a.id === article.id);
      if (exists) {
        return { referencedArticles: state.referencedArticles.filter((a) => a.id !== article.id) };
      } else {
        return { referencedArticles: [...state.referencedArticles, article] };
      }
    });
  },

  removeReferencedArticle: (articleId) => {
    set((state) => ({
      referencedArticles: state.referencedArticles.filter((a) => a.id !== articleId),
    }));
  },

  clearReferencedArticles: () => set({ referencedArticles: [] }),

  addQuotedSnippet: (params) => {
    const snippet: QuoteSnippet = {
      id: `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...params,
    };
    set((state) => ({
      quotedSnippets: [...state.quotedSnippets, snippet],
    }));
  },

  removeQuotedSnippet: (snippetId) => {
    set((state) => ({
      quotedSnippets: state.quotedSnippets.filter((s) => s.id !== snippetId),
    }));
  },

  clearQuotedSnippets: () => set({ quotedSnippets: [] }),

  addReferencedFile: (file) => {
    set((state) => {
      // 去重：同路径不重复添加
      if (state.referencedFiles.some(f => f.path === file.path)) return state;
      return { referencedFiles: [...state.referencedFiles, file] };
    });
  },

  removeReferencedFile: (filePath) => {
    set((state) => ({
      referencedFiles: state.referencedFiles.filter((f) => f.path !== filePath),
    }));
  },

  clearReferencedFiles: () => set({ referencedFiles: [] }),

  addReferencedConversation: (conv) => {
    set((state) => {
      if (state.referencedConversations.some(c => c.conversationId === conv.conversationId)) return state;
      return { referencedConversations: [...state.referencedConversations, conv] };
    });
  },

  removeReferencedConversation: (conversationId) => {
    set((state) => ({
      referencedConversations: state.referencedConversations.filter(c => c.conversationId !== conversationId),
    }));
  },

  clearReferencedConversations: () => set({ referencedConversations: [] }),

  addReferencedSharedFile: (file) => {
    set((state) => {
      if (state.referencedSharedFiles.some(f => f.absPath === file.absPath)) return state;
      return { referencedSharedFiles: [...state.referencedSharedFiles, file] };
    });
  },

  removeReferencedSharedFile: (absPath) => {
    set((state) => ({
      referencedSharedFiles: state.referencedSharedFiles.filter(f => f.absPath !== absPath),
    }));
  },

  clearReferencedSharedFiles: () => set({ referencedSharedFiles: [] }),

  reset: () => set({
    referencedArticles: [],
    quotedSnippets: [],
    referencedFiles: [],
    referencedConversations: [],
    referencedSharedFiles: [],
  }),
}));
