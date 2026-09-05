import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import { rendererEvents } from '@/lib/events';
import type { ArticleMeta, Article, ArticleParseStatus } from '@/types/article';

interface ArticleState {
  // --- 状态 ---
  selectedArticle: Article | null;
  loadingArticleDetail: boolean;
  parsingArticle: boolean;
  showArticleUrlInput: boolean;
  articleUrlInput: string;

  // --- Actions ---
  /** 选择文章，加载完整内容 */
  selectArticle: (articleMeta: ArticleMeta) => Promise<void>;
  /** 删除文章（通过路径） */
  deleteArticle: (articlePath: string) => Promise<void>;
  /** 显示 URL 输入框 */
  showUrlInput: () => void;
  /** 隐藏 URL 输入框 */
  hideUrlInput: () => void;
  /** 设置 URL 输入值 */
  setArticleUrlInput: (value: string) => void;
  /** 提交 URL 解析文章 */
  submitArticleUrl: () => Promise<void>;
  /** 登录墙手动重试：重新解析当前选中的 need_login 文章 */
  retryAfterLogin: () => Promise<void>;
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

export const useArticleStore = create<ArticleState>((set, get) => ({
  selectedArticle: null,
  loadingArticleDetail: false,
  parsingArticle: false,
  showArticleUrlInput: false,
  articleUrlInput: '',

  selectArticle: async (articleMeta) => {
    const workspaceId = await getWorkspaceId();
    if (!workspaceId) {
      console.warn('selectArticle: 无活跃工作区，忽略');
      return;
    }

    try {
      set({ loadingArticleDetail: true });
      const { useWorkspaceStore } = await import('./workspace-store');
      useWorkspaceStore.getState().clearSelectedFile();

      const result = await client.getArticleDetail({ workspaceId, articleId: articleMeta.id });
      if (result.error) {
        console.error('获取文章详情失败:', result.error);
        return;
      }
      set({ selectedArticle: result.article || null });
      if (result.article) {
        const { useSessionStore, ARTICLE_TAB_ID } = await import('./session-store');
        useSessionStore.getState().switchTab(ARTICLE_TAB_ID);
      }
    } catch (error) {
      console.error('获取文章详情失败:', error);
    } finally {
      set({ loadingArticleDetail: false });
    }
  },

  deleteArticle: async (articlePath) => {
    const workspaceId = await getWorkspaceId();
    if (!workspaceId) return;

    if (!await showConfirm('删除文章', '确定要删除这篇文章吗？此操作不可恢复。')) return;

    try {
      const result = await client.deleteItem({ workspaceId, itemPath: articlePath });
      if (result.error) {
        toast.error('删除文章失败', { description: result.error });
        return;
      }
      // 如果删除的是当前选中的文章，清除选中状态（含文章 tab 回退）
      if (get().selectedArticle && get().selectedArticle!.id && articlePath.includes(get().selectedArticle!.id)) {
        get().clearSelectedArticle();
      }
      // 刷新文件树
      const { useWorkspaceStore } = await import('./workspace-store');
      useWorkspaceStore.getState().loadWorkspaceFiles();
    } catch (error) {
      console.error('删除文章失败:', error);
      toast.error('删除文章失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  showUrlInput: () => set({ showArticleUrlInput: true, articleUrlInput: '' }),

  hideUrlInput: () => set({ showArticleUrlInput: false, articleUrlInput: '' }),

  setArticleUrlInput: (value) => set({ articleUrlInput: value }),

  submitArticleUrl: async () => {
    const workspaceId = await getWorkspaceId();
    const { articleUrlInput } = get();
    if (!workspaceId || !articleUrlInput.trim()) return;

    try {
      set({ parsingArticle: true });
      const result = await client.parseArticle({ url: articleUrlInput.trim(), workspaceId });
      if ('error' in result) {
        toast.error('文章解析失败', { description: result.error });
        return;
      }
      if (result.article?.parseStatus !== 'need_login') {
        toast.success('文章保存成功');
      }
      // 关闭输入框
      set({ showArticleUrlInput: false, articleUrlInput: '' });
      // 刷新文件树
      const { useWorkspaceStore } = await import('./workspace-store');
      useWorkspaceStore.getState().loadWorkspaceFiles();
      // 自动选中新解析的文章
      if (result.article) {
        get().selectArticle(result.article);
      }
    } catch (error) {
      console.error('解析文章失败:', error);
      toast.error('文章解析失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ parsingArticle: false });
    }
  },

  retryAfterLogin: async () => {
    const article = get().selectedArticle;
    if (!article) return;
    const workspaceId = await getWorkspaceId();
    if (!workspaceId) return;

    try {
      set({ parsingArticle: true });
      const result = await client.parseArticle({ url: article.url, workspaceId });
      if ('error' in result) {
        toast.error('文章解析失败', { description: result.error });
        return;
      }
      // 新结果落盘后清理旧的 need_login stub，避免树里残留重复条目
      if (result.article && result.article.id !== article.id) {
        await client.deleteArticle({ workspaceId, articleId: article.id }).catch((error) => {
          console.warn('清理旧登录墙条目失败:', error);
        });
      }
      if (result.article?.parseStatus === 'need_login') {
        toast.info('登录态未生效', { description: '请确认已在浏览器窗口完成登录，再点击重试' });
      } else {
        toast.success('文章保存成功');
      }
      const { useWorkspaceStore } = await import('./workspace-store');
      useWorkspaceStore.getState().loadWorkspaceFiles();
      if (result.article) {
        get().selectArticle(result.article);
      }
    } catch (error) {
      console.error('重试解析文章失败:', error);
      toast.error('文章解析失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ parsingArticle: false });
    }
  },

  clearSelectedArticle: () => {
    set({ selectedArticle: null });
    // 文章 tab 随选中态卸载；若当前正停留在文章 tab，回退到最近会话 tab 或笔记
    void import('./session-store').then(({ useSessionStore, ARTICLE_TAB_ID, NOTES_TAB_ID }) => {
      const s = useSessionStore.getState();
      if (s.activeTabId !== ARTICLE_TAB_ID) return;
      const fallback = s.lastActiveConversationTabId;
      const tab = fallback ? s.tabs.find((t) => t.conversationId === fallback) : undefined;
      s.switchTab(tab && !s.sessionWindowIds.has(fallback!) ? fallback! : NOTES_TAB_ID);
    });
  },

  reset: () => set({
    selectedArticle: null,
    loadingArticleDetail: false,
    parsingArticle: false,
    showArticleUrlInput: false,
    articleUrlInput: '',
  }),
}));

// Phase 3: 监听后端解析状态变化，实时更新选中文章的 parseStatus
// 只在浏览器环境启用（有 window.ipcRenderer）
if (typeof window !== 'undefined' && window.ipcRenderer) {
  rendererEvents.articleParseStatusChanged.listen((data: {
    articleId: string;
    workspacePath: string;
    parseStatus: ArticleParseStatus;
  }) => {
    const state = useArticleStore.getState();
    if (state.selectedArticle?.id === data.articleId) {
      useArticleStore.setState({
        selectedArticle: { ...state.selectedArticle, parseStatus: data.parseStatus },
      });
    }
  });

  // 浏览器层遇登录墙：主进程已把浏览器窗口置前并落 need_login stub，这里提示用户
  rendererEvents.browserLoginRequired.listen(() => {
    toast.info('该页面需要登录，已为你打开浏览器窗口');
    void import('./workspace-store').then(({ useWorkspaceStore }) => {
      useWorkspaceStore.getState().loadWorkspaceFiles();
    });
  });
}
