import { create } from 'zustand';
import { client } from '@/lib/client';
import type { Workspace, WorkspaceFileNode } from '@/types/electron-api';
import type { Book } from '@/types';

interface WorkspaceState {
  // --- 状态 ---
  workspace: Workspace | null;
  files: WorkspaceFileNode[];
  selectedFile: WorkspaceFileNode | null;
  selectedBook: Book | null;
  workspaceFilePath: string | null;
  loadingFiles: boolean;
  importing: boolean;
  deleting: boolean;

  // --- Actions ---
  /** 设置工作区，触发 files/conversations/articles 加载 */
  setWorkspace: (workspace: Workspace) => void;
  /** 加载工作区文件列表 */
  loadWorkspaceFiles: () => Promise<void>;
  /** 选择文件，加载关联书籍信息 */
  selectFile: (file: WorkspaceFileNode) => Promise<void>;
  /** 设置选中书籍（供其他 store 调用） */
  setSelectedBook: (book: Book | null) => void;
  /** 清除文件选中状态 */
  clearSelectedFile: () => void;
  /** 导入书籍 */
  importBook: () => Promise<void>;
  /** 删除当前选中书籍 */
  deleteBook: () => Promise<void>;
  /** 在文件管理器中打开书籍 */
  openBookInFolder: () => Promise<void>;
  /** 打开 Agent 监控窗口 */
  openMonitorWindow: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: null,
  files: [],
  selectedFile: null,
  selectedBook: null,
  workspaceFilePath: null,
  loadingFiles: false,
  importing: false,
  deleting: false,

  setWorkspace: (workspace) => {
    set({ workspace });
    // 触发文件列表加载
    get().loadWorkspaceFiles();
    // 触发对话和文章列表加载（延迟导入避免循环依赖）
    import('./conversation-store').then(({ useConversationStore }) => {
      useConversationStore.getState().loadConversations();
    });
    import('./article-store').then(({ useArticleStore }) => {
      useArticleStore.getState().loadArticles();
    });
  },

  loadWorkspaceFiles: async () => {
    const { workspace } = get();
    if (!workspace) return;

    try {
      set({ loadingFiles: true });
      const result = await client.getFiles({ workspaceId: workspace.id });
      if (result.files) {
        set({ files: result.files });
      }
    } catch (error) {
      console.error('加载工作区文件失败:', error);
    } finally {
      set({ loadingFiles: false });
    }
  },

  selectFile: async (file) => {
    set({ selectedFile: file, workspaceFilePath: null });
    try {
      const bookId = (file as any).bookId;
      if (bookId) {
        const book = await client.getBookByFilePath({ filePathOrBookId: bookId });
        set({ selectedBook: book || null });
        // 获取工作区中的文件路径
        if (book) {
          const pathResult = await client.getWorkspaceFilePath({ bookId });
          if (pathResult.path) {
            set({ workspaceFilePath: pathResult.path });
          }
        }
      } else {
        set({ selectedBook: null });
      }
    } catch (error) {
      console.error('获取书籍信息失败:', error);
      set({ selectedBook: null });
    }
  },

  setSelectedBook: (book) => set({ selectedBook: book }),

  clearSelectedFile: () => set({ selectedFile: null }),

  importBook: async () => {
    const { workspace } = get();
    if (!workspace) return;

    try {
      set({ importing: true });
      const filePath = await client.selectFile();
      if (filePath) {
        await client.importBook({ filePath, workspaceId: workspace.id });
        // 导入成功后刷新文件列表和对话列表
        get().loadWorkspaceFiles();
        import('./conversation-store').then(({ useConversationStore }) => {
          useConversationStore.getState().loadConversations();
        });
      }
    } catch (error) {
      console.error('导入失败:', error);
      alert(`导入失败: ${(error as Error).message}`);
    } finally {
      set({ importing: false });
    }
  },

  deleteBook: async () => {
    const { selectedBook } = get();
    if (!selectedBook?.id) return;

    if (!confirm(`确定要删除《${selectedBook.title}》吗？此操作不可恢复。`)) {
      return;
    }

    try {
      set({ deleting: true });
      await client.deleteBook({ id: selectedBook.id });
      set({ selectedBook: null, selectedFile: null });
      get().loadWorkspaceFiles();
    } catch (error) {
      console.error('删除失败:', error);
      alert(`删除失败: ${(error as Error).message}`);
    } finally {
      set({ deleting: false });
    }
  },

  openBookInFolder: async () => {
    const { selectedBook } = get();
    if (!selectedBook?.id) return;
    try {
      await client.openBookInFolder({ bookId: selectedBook.id });
    } catch (error) {
      console.error('打开文件失败:', error);
    }
  },

  openMonitorWindow: async () => {
    try {
      await client.openMonitorWindow();
    } catch (error) {
      console.error('打开监控窗口失败:', error);
    }
  },
}));
