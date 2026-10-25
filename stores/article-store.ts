import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { ArticleMeta, Article, ArticleParseStatus } from '@/types/article';

interface ArticleState {
  // --- 状态 ---
  selectedArticle: Article | null;
  loadingArticleDetail: boolean;
  parsingArticle: boolean;
  retryingArticle: boolean;
  showArticleUrlInput: boolean;
  articleUrlInput: string;

  // --- Actions ---
  /** 选择文章（路径形态）：加载详情并打开阅读 tab（阅读视图按 dogear/articles 内路径识别文章模式） */
  selectArticle: (articleMeta: ArticleMeta) => Promise<void>;
  /** 仅加载文章详情（阅读视图从最近列表恢复/切换文章时用，不触发路由） */
  loadArticleDetailByPath: (workspaceId: string, relPath: string) => Promise<void>;
  /** 重试解析当前选中文章：走既有 parseArticle 管线，成功后打开新文章 */
  retryParse: () => Promise<void>;
  /** 显示 URL 输入框 */
  showUrlInput: () => void;
  /** 隐藏 URL 输入框 */
  hideUrlInput: () => void;
  /** 设置 URL 输入值 */
  setArticleUrlInput: (value: string) => void;
  /** 提交 URL 解析文章；返回是否提交成功 */
  submitArticleUrl: () => Promise<boolean>;
  /** 清除选中的文章 */
  clearSelectedArticle: () => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

/** 从 workspace-store 获取当前工作区 ID（延迟导入避免循环依赖） */
const getWorkspaceId = async () => {
  const { useWorkspaceStore } = await import('./workspace-store');
  return useWorkspaceStore.getState().workspace?.id;
};

/** 打开阅读 tab 的文件目标（路由逻辑收口在 markdown-preview-store；文章模式由阅读面板按路径识别） */
function openInReadingTab(workspaceId: string, articlePath: string, title: string) {
  void import('./markdown-preview-store').then(({ useMarkdownPreviewStore }) => {
    useMarkdownPreviewStore.getState().open(workspaceId, articlePath, title);
  });
}

export const useArticleStore = create<ArticleState>((set, get) => ({
  selectedArticle: null,
  loadingArticleDetail: false,
  parsingArticle: false,
  retryingArticle: false,
  showArticleUrlInput: false,
  articleUrlInput: '',

  loadArticleDetailByPath: async (workspaceId, relPath) => {
    try {
      set({ loadingArticleDetail: true });
      const result = await client.getArticleByPath({ workspaceId, relPath });
      if (result.error || !result.article) {
        if (result.error) console.error('获取文章详情失败:', result.error);
        set({ selectedArticle: null });
        return;
      }
      set({ selectedArticle: { ...result.article, path: relPath } });
    } catch (error) {
      console.error('获取文章详情失败:', error);
    } finally {
      set({ loadingArticleDetail: false });
    }
  },

  selectArticle: async (articleMeta) => {
    const workspaceId = await getWorkspaceId();
    if (!workspaceId) {
      console.warn('selectArticle: 无活跃工作区，忽略');
      return;
    }
    if (!articleMeta.path) {
      console.warn('selectArticle: 文章缺少路径，忽略');
      return;
    }

    const { useWorkspaceStore } = await import('./workspace-store');
    useWorkspaceStore.getState().clearSelectedFile();
    openInReadingTab(workspaceId, articleMeta.path, articleMeta.title);
    await get().loadArticleDetailByPath(workspaceId, articleMeta.path);
  },

  retryParse: async () => {
    const article = get().selectedArticle;
    if (!article) return;
    const workspaceId = await getWorkspaceId();
    if (!workspaceId) return;

    try {
      set({ retryingArticle: true });
      const result = await client.parseArticle({ url: article.url, workspaceId });
      if ('error' in result) {
        toast.error('重试解析失败', { description: result.error });
        return;
      }
      // 管线按 URL 新建文章条目；成功后切到新文章（articlePath 为实际落盘相对路径）
      const { useWorkspaceStore } = await import('./workspace-store');
      useWorkspaceStore.getState().loadWorkspaceFiles();
      if (result.article && result.articlePath) {
        await get().selectArticle({ ...result.article, path: result.articlePath });
        toast.success('重新解析完成');
      }
    } catch (error) {
      toast.error('重试解析失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ retryingArticle: false });
    }
  },

  showUrlInput: () => set({ showArticleUrlInput: true, articleUrlInput: '' }),

  hideUrlInput: () => set({ showArticleUrlInput: false, articleUrlInput: '' }),

  setArticleUrlInput: (value) => set({ articleUrlInput: value }),

  submitArticleUrl: async () => {
    const workspaceId = await getWorkspaceId();
    const { articleUrlInput } = get();
    if (!workspaceId || !articleUrlInput.trim()) return false;

    try {
      set({ parsingArticle: true });
      const result = await client.parseArticle({ url: articleUrlInput.trim(), workspaceId });
      if ('error' in result) {
        toast.error('文章解析失败', { description: result.error });
        return false;
      }
      // 关闭输入框
      set({ showArticleUrlInput: false, articleUrlInput: '' });
      // 刷新文件树
      const { useWorkspaceStore } = await import('./workspace-store');
      useWorkspaceStore.getState().loadWorkspaceFiles();
      // 自动选中新解析的文章（articlePath 为实际落盘相对路径）
      if (result.article && result.articlePath) {
        await get().selectArticle({ ...result.article, path: result.articlePath });
      }
      return true;
    } catch (error) {
      console.error('解析文章失败:', error);
      toast.error('文章解析失败', { description: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set({ parsingArticle: false });
    }
  },

  clearSelectedArticle: () => set({ selectedArticle: null }),

  reset: () => set({
    selectedArticle: null,
    loadingArticleDetail: false,
    parsingArticle: false,
    retryingArticle: false,
    showArticleUrlInput: false,
    articleUrlInput: '',
  }),
}));

// 监听后端解析状态变化，实时更新选中文章的 parseStatus
// 只在浏览器环境启用（有 window.ipcRenderer）
if (typeof window !== 'undefined' && window.ipcRenderer) {
  rendererEvents.articleParseStatusChanged.listen((data: {
    articleId: string;
    workspaceId: string;
    parseStatus: ArticleParseStatus;
  }) => {
    const state = useArticleStore.getState();
    if (state.selectedArticle?.id === data.articleId) {
      useArticleStore.setState({
        selectedArticle: { ...state.selectedArticle, parseStatus: data.parseStatus },
      });
    }
  });
}
