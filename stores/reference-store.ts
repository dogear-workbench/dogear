import { create } from 'zustand';
import type { ArticleMeta, QuoteSnippet } from '@/types/article';

/** 带锚定归属的文章引用（ArticleMeta 为主进程存储格式，锚定字段只在渲染层附加） */
export type AnchoredArticle = ArticleMeta & { anchorConversationId: string };

/** 文件/文件夹引用 */
export interface FileReference {
  name: string;      // 文件名或文件夹名
  path: string;      // 绝对路径
  type?: 'file' | 'folder';  // 默认 'file'
  anchorConversationId: string;
}

/** 会话引用 */
export interface ConversationReference {
  conversationId: string;
  title: string;
  sessionId: string | null;
  workspaceId: string;
  anchorConversationId: string;
}

/** 共享文件引用（会话组共享区） */
export interface SharedFileReference {
  groupId: string;
  relPath: string;
  absPath: string;
  anchorConversationId: string;
}

/** 会话消息选中片段（会话流内选中文字 → 引用） */
export interface MessageSnippetRef {
  id: string;
  text: string;
  timestamp: number;
  anchorConversationId: string;
}

/** 笔记引用 */
export interface NoteReference {
  noteId: string;
  title: string;
  workspaceId: string;
  anchorConversationId: string;
}

/** 分流操作气泡（建议卡点击后插入输入框，同会话最多一个，发送时消费） */
export interface ShuntBubble {
  action: 'new-session' | 'new-topic' | 'note';
  summary: string;
}

interface ReferenceState {
  // --- 状态 ---
  referencedArticles: AnchoredArticle[];
  quotedSnippets: QuoteSnippet[];
  messageSnippets: MessageSnippetRef[];
  referencedFiles: FileReference[];
  referencedConversations: ConversationReference[];
  referencedSharedFiles: SharedFileReference[];
  referencedNotes: NoteReference[];
  shuntBubbles: Record<string, ShuntBubble>;

  // --- Actions ---
  /** 引用/取消引用文章 */
  toggleReferenceArticle: (article: ArticleMeta, anchorConversationId: string) => void;
  /** 移除单篇引用文章 */
  removeReferencedArticle: (articleId: string) => void;
  /** 清空锚定指定会话的引用文章 */
  clearReferencedArticlesFor: (conversationId: string) => void;
  /** 添加引用片段 */
  addQuotedSnippet: (params: { articleId: string; articleTitle: string; text: string }, anchorConversationId: string) => void;
  /** 移除单条引用片段 */
  removeQuotedSnippet: (snippetId: string) => void;
  /** 清空锚定指定会话的引用片段 */
  clearQuotedSnippetsFor: (conversationId: string) => void;
  /** 添加会话消息选中片段 */
  addMessageSnippet: (params: { text: string; timestamp: number }, anchorConversationId: string) => void;
  /** 移除单条会话消息片段 */
  removeMessageSnippet: (snippetId: string) => void;
  /** 清空锚定指定会话的会话消息片段 */
  clearMessageSnippetsFor: (conversationId: string) => void;
  /** 添加文件引用 */
  addReferencedFile: (file: Omit<FileReference, 'anchorConversationId'>, anchorConversationId: string) => void;
  /** 移除文件引用 */
  removeReferencedFile: (filePath: string) => void;
  /** 清空锚定指定会话的文件引用 */
  clearReferencedFilesFor: (conversationId: string) => void;
  /** 添加会话引用（去重） */
  addReferencedConversation: (conv: Omit<ConversationReference, 'anchorConversationId'>, anchorConversationId: string) => void;
  /** 移除会话引用 */
  removeReferencedConversation: (conversationId: string) => void;
  /** 清空锚定指定会话的会话引用 */
  clearReferencedConversationsFor: (conversationId: string) => void;
  /** 添加共享文件引用（去重） */
  addReferencedSharedFile: (file: Omit<SharedFileReference, 'anchorConversationId'>, anchorConversationId: string) => void;
  /** 移除共享文件引用 */
  removeReferencedSharedFile: (absPath: string) => void;
  /** 清空锚定指定会话的共享文件引用 */
  clearReferencedSharedFilesFor: (conversationId: string) => void;
  /** 添加笔记引用（去重） */
  addReferencedNote: (note: Omit<NoteReference, 'anchorConversationId'>, anchorConversationId: string) => void;
  /** 移除笔记引用 */
  removeReferencedNote: (noteId: string) => void;
  /** 清空锚定指定会话的笔记引用 */
  clearReferencedNotesFor: (conversationId: string) => void;
  /** 插入/覆盖分流气泡（同会话仅一个，覆盖由调用方确认） */
  setShuntBubble: (conversationId: string, bubble: ShuntBubble) => void;
  /** 移除分流气泡（发送消费或用户删除） */
  removeShuntBubble: (conversationId: string) => void;
  /** 清掉锚定指定会话的全部引用项（会话 tab 关闭时调用） */
  clearAllFor: (conversationId: string) => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

export const useReferenceStore = create<ReferenceState>((set) => ({
  referencedArticles: [],
  quotedSnippets: [],
  messageSnippets: [],
  referencedFiles: [],
  referencedConversations: [],
  referencedSharedFiles: [],
  referencedNotes: [],
  shuntBubbles: {},

  setShuntBubble: (conversationId, bubble) => {
    set((state) => ({ shuntBubbles: { ...state.shuntBubbles, [conversationId]: bubble } }));
  },

  removeShuntBubble: (conversationId) => {
    set((state) => {
      if (!(conversationId in state.shuntBubbles)) return state;
      const next = { ...state.shuntBubbles };
      delete next[conversationId];
      return { shuntBubbles: next };
    });
  },

  toggleReferenceArticle: (article, anchorConversationId) => {
    set((state) => {
      const exists = state.referencedArticles.some((a) => a.id === article.id);
      if (exists) {
        return { referencedArticles: state.referencedArticles.filter((a) => a.id !== article.id) };
      } else {
        return { referencedArticles: [...state.referencedArticles, { ...article, anchorConversationId }] };
      }
    });
  },

  removeReferencedArticle: (articleId) => {
    set((state) => ({
      referencedArticles: state.referencedArticles.filter((a) => a.id !== articleId),
    }));
  },

  clearReferencedArticlesFor: (conversationId) => {
    set((state) => ({
      referencedArticles: state.referencedArticles.filter((a) => a.anchorConversationId !== conversationId),
    }));
  },

  addQuotedSnippet: (params, anchorConversationId) => {
    const snippet: QuoteSnippet = {
      id: `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...params,
      anchorConversationId,
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

  clearQuotedSnippetsFor: (conversationId) => {
    set((state) => ({
      quotedSnippets: state.quotedSnippets.filter((s) => s.anchorConversationId !== conversationId),
    }));
  },

  addMessageSnippet: (params, anchorConversationId) => {
    const snippet: MessageSnippetRef = {
      id: `msg-snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...params,
      anchorConversationId,
    };
    set((state) => ({
      messageSnippets: [...state.messageSnippets, snippet],
    }));
  },

  removeMessageSnippet: (snippetId) => {
    set((state) => ({
      messageSnippets: state.messageSnippets.filter((s) => s.id !== snippetId),
    }));
  },

  clearMessageSnippetsFor: (conversationId) => {
    set((state) => ({
      messageSnippets: state.messageSnippets.filter((s) => s.anchorConversationId !== conversationId),
    }));
  },

  addReferencedFile: (file, anchorConversationId) => {
    set((state) => {
      // 去重：同路径不重复添加
      if (state.referencedFiles.some(f => f.path === file.path)) return state;
      return { referencedFiles: [...state.referencedFiles, { ...file, anchorConversationId }] };
    });
  },

  removeReferencedFile: (filePath) => {
    set((state) => ({
      referencedFiles: state.referencedFiles.filter((f) => f.path !== filePath),
    }));
  },

  clearReferencedFilesFor: (conversationId) => {
    set((state) => ({
      referencedFiles: state.referencedFiles.filter((f) => f.anchorConversationId !== conversationId),
    }));
  },

  addReferencedConversation: (conv, anchorConversationId) => {
    set((state) => {
      if (state.referencedConversations.some(c => c.conversationId === conv.conversationId)) return state;
      return { referencedConversations: [...state.referencedConversations, { ...conv, anchorConversationId }] };
    });
  },

  removeReferencedConversation: (conversationId) => {
    set((state) => ({
      referencedConversations: state.referencedConversations.filter(c => c.conversationId !== conversationId),
    }));
  },

  clearReferencedConversationsFor: (conversationId) => {
    set((state) => ({
      referencedConversations: state.referencedConversations.filter(c => c.anchorConversationId !== conversationId),
    }));
  },

  addReferencedSharedFile: (file, anchorConversationId) => {
    set((state) => {
      if (state.referencedSharedFiles.some(f => f.absPath === file.absPath)) return state;
      return { referencedSharedFiles: [...state.referencedSharedFiles, { ...file, anchorConversationId }] };
    });
  },

  removeReferencedSharedFile: (absPath) => {
    set((state) => ({
      referencedSharedFiles: state.referencedSharedFiles.filter(f => f.absPath !== absPath),
    }));
  },

  clearReferencedSharedFilesFor: (conversationId) => {
    set((state) => ({
      referencedSharedFiles: state.referencedSharedFiles.filter(f => f.anchorConversationId !== conversationId),
    }));
  },

  addReferencedNote: (note, anchorConversationId) => {
    set((state) => {
      if (state.referencedNotes.some(n => n.noteId === note.noteId)) return state;
      return { referencedNotes: [...state.referencedNotes, { ...note, anchorConversationId }] };
    });
  },

  removeReferencedNote: (noteId) => {
    set((state) => ({
      referencedNotes: state.referencedNotes.filter(n => n.noteId !== noteId),
    }));
  },

  clearReferencedNotesFor: (conversationId) => {
    set((state) => ({
      referencedNotes: state.referencedNotes.filter(n => n.anchorConversationId !== conversationId),
    }));
  },

  clearAllFor: (conversationId) => {
    set((state) => ({
      referencedArticles: state.referencedArticles.filter((a) => a.anchorConversationId !== conversationId),
      quotedSnippets: state.quotedSnippets.filter((s) => s.anchorConversationId !== conversationId),
      messageSnippets: state.messageSnippets.filter((s) => s.anchorConversationId !== conversationId),
      referencedFiles: state.referencedFiles.filter((f) => f.anchorConversationId !== conversationId),
      referencedConversations: state.referencedConversations.filter((c) => c.anchorConversationId !== conversationId),
      referencedSharedFiles: state.referencedSharedFiles.filter((f) => f.anchorConversationId !== conversationId),
      referencedNotes: state.referencedNotes.filter((n) => n.anchorConversationId !== conversationId),
      shuntBubbles: Object.fromEntries(
        Object.entries(state.shuntBubbles).filter(([id]) => id !== conversationId),
      ),
    }));
  },

  reset: () => set({
    referencedArticles: [],
    quotedSnippets: [],
    messageSnippets: [],
    referencedFiles: [],
    referencedConversations: [],
    referencedSharedFiles: [],
    referencedNotes: [],
    shuntBubbles: {},
  }),
}));
