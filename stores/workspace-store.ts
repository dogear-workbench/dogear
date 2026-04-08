import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
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
  /** 正在创建文件夹的父路径（null 表示未在创建） */
  creatingFolderAt: string | null;

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
  /** 清空工作区（回到选择页），同时关闭所有会话并重置所有相关 store */
  clearWorkspace: () => Promise<void>;
  /** 打开自选股窗口 */
  openStockWindow: () => Promise<void>;
  /** 设置正在创建文件夹的父路径 */
  setCreatingFolderAt: (parentPath: string | null) => void;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  renameItem: (itemPath: string, newName: string) => Promise<void>;
  moveItem: (sourcePath: string, targetPath: string, targetIndex?: number) => Promise<void>;
  copyItem: (sourcePath: string, targetPath: string) => Promise<void>;
  deleteItem: (itemPath: string) => Promise<void>;
  openInExplorer: (itemPath: string) => Promise<void>;
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
  creatingFolderAt: null,
  setCreatingFolderAt: (parentPath) => set({ creatingFolderAt: parentPath }),
  setWorkspace: async (workspace) => {
    set({ workspace });
    // 持久化为默认工作区，确保 Agent 会话使用正确的工作区路径
    try {
      await client.setDefault({ workspaceId: workspace.id });
    } catch (error) {
      console.error('设置默认工作区失败:', error);
    }
    // 触发文件列表加载
    get().loadWorkspaceFiles();
    // 触发对话列表加载（延迟导入避免循环依赖）
    import('./conversation-store').then(({ useConversationStore }) => {
      useConversationStore.getState().loadConversations();
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
        toast.success('书籍导入成功');
        // 导入成功后刷新文件列表和对话列表
        get().loadWorkspaceFiles();
        import('./conversation-store').then(({ useConversationStore }) => {
          useConversationStore.getState().loadConversations();
        });
      }
    } catch (error) {
      console.error('导入失败:', error);
      toast.error('导入失败', { description: (error as Error).message });
    } finally {
      set({ importing: false });
    }
  },

  deleteBook: async () => {
    const { selectedBook } = get();
    if (!selectedBook?.id) return;

    if (!await showConfirm('删除书籍', `确定要删除《${selectedBook.title}》吗？此操作不可恢复。`)) {
      return;
    }

    try {
      set({ deleting: true });
      await client.deleteBook({ id: selectedBook.id });
      set({ selectedBook: null, selectedFile: null });
      get().loadWorkspaceFiles();
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败', { description: (error as Error).message });
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

  clearWorkspace: async () => {
    // 1. 关闭所有打开的 Agent 会话
    const { useSessionStore } = await import('./session-store');
    const tabs = useSessionStore.getState().tabs;
    for (const tab of tabs) {
      if (tab.sessionId) {
        try {
          await client.closeQueryBasedSession({ sessionId: tab.sessionId });
        } catch (e) {
          console.warn('关闭会话失败:', tab.sessionId, e);
        }
      }
    }

    // 2. 重置所有相关 store
    const { useConversationStore } = await import('./conversation-store');
    const { useArticleStore } = await import('./article-store');
    const { useReferenceStore } = await import('./reference-store');
    const { useAnalysisStore } = await import('./analysis-store');
    const { useUIStore } = await import('./ui-store');
    const { useSlashCommandStore } = await import('./slash-command-store');

    useConversationStore.getState().reset();
    useArticleStore.getState().reset();
    useReferenceStore.getState().reset();
    useAnalysisStore.getState().reset();
    useUIStore.getState().reset();
    useSlashCommandStore.getState().reset();
    useSessionStore.getState().reset();

    // 3. 最后清除自身状态
    set({ workspace: null, files: [], selectedFile: null, selectedBook: null, workspaceFilePath: null });
  },

  openStockWindow: async () => {
    try {
      await client.openStockWindow();
    } catch (error) {
      console.error('打开自选股窗口失败:', error);
    }
  },

  createFolder: async (parentPath, name) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.createFolder({ workspaceId: workspace.id, parentPath, name });
      if (result.error) { toast.error('创建文件夹失败', { description: result.error }); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('创建文件夹失败:', error);
      toast.error('创建文件夹失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  renameItem: async (itemPath, newName) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.renameItem({ workspaceId: workspace.id, itemPath, newName });
      if (result.error) { toast.error('重命名失败', { description: result.error }); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('重命名失败:', error);
      toast.error('重命名失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  moveItem: async (sourcePath, targetPath, targetIndex) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.moveItem({ workspaceId: workspace.id, sourcePath, targetPath, targetIndex });
      if (result.error) { toast.error('移动失败', { description: result.error }); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('移动失败:', error);
      toast.error('移动失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  copyItem: async (sourcePath, targetPath) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.copyItem({ workspaceId: workspace.id, sourcePath, targetPath });
      if (result.error) { toast.error('复制失败', { description: result.error }); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('复制失败:', error);
      toast.error('复制失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  deleteItem: async (itemPath) => {
    const { workspace } = get();
    if (!workspace) return;
    if (!await showConfirm('删除项目', '确定要删除吗？此操作不可恢复。')) return;
    try {
      const result = await client.deleteItem({ workspaceId: workspace.id, itemPath });
      if (result.error) { toast.error('删除失败', { description: result.error }); return; }
      // 如果删除的是当前选中的文件，清除选中
      const { selectedFile } = get();
      if (selectedFile && selectedFile.path === itemPath) {
        set({ selectedFile: null, selectedBook: null });
      }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  openInExplorer: async (itemPath) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      await client.openInExplorer({ workspaceId: workspace.id, itemPath });
    } catch (error) {
      console.error('打开文件管理器失败:', error);
    }
  },
}));
