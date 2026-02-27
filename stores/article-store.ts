import { create } from 'zustand';
import { client } from '@/lib/client';
import type { ArticleMeta, Article } from '@/types/article';

interface ArticleState {
  // --- 状态 ---
  articles: ArticleMeta[];
  selectedArticle: Article | null;
  loadingArticles: boolean;
  loadingArticleDetail: boolean;
  parsingArticle: boolean;
  showArticleUrlInput: boolean;
  articleUrlInput: string;

  // --- Actions ---
  /** 加载工作区文章列表 */
  loadArticles: () => Promise<void>;
  /** 选择文章，加载完整内容 */
  selectArticle: (articleMeta: ArticleMeta) => Promise<void>;
  /** 删除文章 */
  deleteArticle: (articleId: string) => Promise<void>;
  /** 显示 URL 输入框 */
  showUrlInput: () => void;
  /** 隐藏 URL 输入框 */
  hideUrlInput: () => void;
  /** 设置 URL 输入值 */
  setArticleUrlInput: (value: string) => void;
  /** 提交 URL 解析文章 */
  submitArticleUrl: () => Promise<void>;
  /** 清除选中的文章 */
  clearSelectedArticle: () => void;
}

/** 从 workspace-store 获取当前工作区 ID */
const getWorkspaceId = () => {
  // 延迟导入避免循环依赖
  const { useWorkspaceStore } = require('./workspace-store');
  return useWorkspaceStore.getState().workspace?.id;
};

export const useArticleStore = create<ArticleState>((set, get) => ({
  articles: [],
  selectedArticle: null,
  loadingArticles: false,
  loadingArticleDetail: false,
  parsingArticle: false,
  showArticleUrlInput: false,
  articleUrlInput: '',

  loadArticles: async () => {
    const workspaceId = getWorkspaceId();
    if (!workspaceId) return;

    try {
      set({ loadingArticles: true });
      const result = await client.getArticles({ workspaceId });
      set({ articles: result.articles || [] });
    } catch (error) {
      console.error('加载文章列表失败:', error);
    } finally {
      set({ loadingArticles: false });
    }
  },

  selectArticle: async (articleMeta) => {
    const workspaceId = getWorkspaceId();
    if (!workspaceId) return;

    try {
      set({ loadingArticleDetail: true });
      // 清除书籍选中状态
      const { useWorkspaceStore } = require('./workspace-store');
      useWorkspaceStore.getState().setSelectedBook(null);
      useWorkspaceStore.getState().clearSelectedFile();

      const result = await client.getArticleDetail({ workspaceId, articleId: articleMeta.id });
      if (result.error) {
        console.error('获取文章详情失败:', result.error);
        return;
      }
      set({ selectedArticle: result.article || null });
    } catch (error) {
      console.error('获取文章详情失败:', error);
    } finally {
      set({ loadingArticleDetail: false });
    }
  },

  deleteArticle: async (articleId) => {
    const workspaceId = getWorkspaceId();
    if (!workspaceId) return;

    if (!confirm('确定要删除这篇文章吗？此操作不可恢复。')) return;

    try {
      const result = await client.deleteArticle({ workspaceId, articleId });
      if (result.error) {
        alert(`删除失败: ${result.error}`);
        return;
      }
      // 如果删除的是当前选中的文章，清除选中状态
      if (get().selectedArticle?.id === articleId) {
        set({ selectedArticle: null });
      }
      await get().loadArticles();
    } catch (error) {
      console.error('删除文章失败:', error);
      alert(`删除失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  showUrlInput: () => set({ showArticleUrlInput: true, articleUrlInput: '' }),

  hideUrlInput: () => set({ showArticleUrlInput: false, articleUrlInput: '' }),

  setArticleUrlInput: (value) => set({ articleUrlInput: value }),

  submitArticleUrl: async () => {
    const workspaceId = getWorkspaceId();
    const { articleUrlInput } = get();
    if (!workspaceId || !articleUrlInput.trim()) return;

    try {
      set({ parsingArticle: true });
      const result = await client.parseArticle({ url: articleUrlInput.trim(), workspaceId });
      if (result.error) {
        alert(`解析失败: ${result.error}`);
        return;
      }
      // 关闭输入框
      set({ showArticleUrlInput: false, articleUrlInput: '' });
      // 刷新文章列表
      await get().loadArticles();
      // 自动选中新解析的文章
      if (result.article) {
        get().selectArticle(result.article);
      }
    } catch (error) {
      console.error('解析文章失败:', error);
      alert(`解析失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      set({ parsingArticle: false });
    }
  },

  clearSelectedArticle: () => set({ selectedArticle: null }),
}));
