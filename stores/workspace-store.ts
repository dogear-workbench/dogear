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

  /** 设置正在创建文件夹的父路径 */
  setCreatingFolderAt: (parentPath: string | null) => void;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  renameItem: (itemPath: string, newName: string) => Promise<void>;
  moveItem: (sourcePath: string, targetPath: string) => Promise<void>;
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
  setWorkspace: (workspace) => {
    set({ workspace });
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

  createFolder: async (parentPath, name) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.createFolder({ workspaceId: workspace.id, parentPath, name });
      if (result.error) { alert(`创建失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('创建文件夹失败:', error);
      alert(`创建失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  renameItem: async (itemPath, newName) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.renameItem({ workspaceId: workspace.id, itemPath, newName });
      if (result.error) { alert(`重命名失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('重命名失败:', error);
      alert(`重命名失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  moveItem: async (sourcePath, targetPath) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.moveItem({ workspaceId: workspace.id, sourcePath, targetPath });
      if (result.error) { alert(`移动失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('移动失败:', error);
      alert(`移动失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  copyItem: async (sourcePath, targetPath) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      const result = await client.copyItem({ workspaceId: workspace.id, sourcePath, targetPath });
      if (result.error) { alert(`复制失败: ${result.error}`); return; }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('复制失败:', error);
      alert(`复制失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  deleteItem: async (itemPath) => {
    const { workspace } = get();
    if (!workspace) return;
    if (!confirm('确定要删除吗？此操作不可恢复。')) return;
    try {
      const result = await client.deleteItem({ workspaceId: workspace.id, itemPath });
      if (result.error) { alert(`删除失败: ${result.error}`); return; }
      // 如果删除的是当前选中的文件，清除选中
      const { selectedFile } = get();
      if (selectedFile && selectedFile.path === itemPath) {
        set({ selectedFile: null, selectedBook: null });
      }
      await get().loadWorkspaceFiles();
    } catch (error) {
      console.error('删除失败:', error);
      alert(`删除失败: ${error instanceof Error ? error.message : String(error)}`);
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
