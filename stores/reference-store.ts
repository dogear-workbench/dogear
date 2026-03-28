import { create } from 'zustand';
import type { ArticleMeta, QuoteSnippet } from '@/types/article';

/** 文件引用 */
export interface FileReference {
  name: string;      // 文件名
  path: string;      // 绝对路径
}

interface ReferenceState {
  // --- 状态 ---
  referencedArticles: ArticleMeta[];
  quotedSnippets: QuoteSnippet[];
  referencedFiles: FileReference[];

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
}

export const useReferenceStore = create<ReferenceState>((set) => ({
  referencedArticles: [],
  quotedSnippets: [],
  referencedFiles: [],

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
}));
