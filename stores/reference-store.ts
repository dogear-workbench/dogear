import { create } from 'zustand';
import type { ArticleMeta, QuoteSnippet } from '@/types/article';

interface ReferenceState {
  // --- 状态 ---
  referencedArticles: ArticleMeta[];
  quotedSnippets: QuoteSnippet[];

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
}

export const useReferenceStore = create<ReferenceState>((set) => ({
  referencedArticles: [],
  quotedSnippets: [],

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
}));
