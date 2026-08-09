import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import type { Workspace, WorkspaceFileNode } from '@/types/electron-api';

interface WorkspaceState {
  // --- 状态 ---
  workspace: Workspace | null;
  files: WorkspaceFileNode[];
  selectedFile: WorkspaceFileNode | null;
  loadingFiles: boolean;
  /** 正在创建文件夹的父路径（null 表示未在创建） */
  creatingFolderAt: string | null;

  // --- Actions ---
  /** 设置工作区，触发 files/conversations/articles 加载。skipSetDefault=true 时不修改默认工作区（独立窗口用） */
  setWorkspace: (workspace: Workspace, options?: { skipSetDefault?: boolean }) => Promise<void>;
  /** 加载工作区文件列表 */
  loadWorkspaceFiles: () => Promise<void>;
  /** 选择文件 */
  selectFile: (file: WorkspaceFileNode) => Promise<void>;
  /** 清除文件选中状态 */
  clearSelectedFile: () => void;
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
  loadingFiles: false,
  creatingFolderAt: null,
  setCreatingFolderAt: (parentPath) => set({ creatingFolderAt: parentPath }),
  setWorkspace: async (workspace, options?) => {
    const prev = get().workspace;
    const workspaceChanged = prev?.id !== workspace.id;
    const { useConversationStore } = await import('./conversation-store');
    if (workspaceChanged) {
      const { useArticleStore } = await import('./article-store');
      useArticleStore.getState().clearSelectedArticle();
      useConversationStore.getState().activateWorkspace(workspace.id);
      set({
        workspace,
        selectedFile: null,
        files: [],
      });
    } else {
      useConversationStore.getState().activateWorkspace(workspace.id);
      set({ workspace });
    }
    if (!options?.skipSetDefault) {
      try {
        await client.setDefault({ workspaceId: workspace.id });
      } catch (error) {
        console.error('设置默认工作区失败:', error);
      }
    }
    get().loadWorkspaceFiles();
    useConversationStore.getState().loadConversations();
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
    set({ selectedFile: file });
  },

  clearSelectedFile: () => set({ selectedFile: null }),

  openMonitorWindow: async () => {
    try {
      await client.openMonitorWindow();
    } catch (error) {
      console.error('打开监控窗口失败:', error);
    }
  },

  clearWorkspace: async () => {
    const { useConversationStore } = await import('./conversation-store');
    const { useArticleStore } = await import('./article-store');
    const { useReferenceStore } = await import('./reference-store');
    const { useUIStore } = await import('./ui-store');
    const { useSlashCommandStore } = await import('./slash-command-store');
    const { useSessionStore } = await import('./session-store');

    useConversationStore.getState().activateWorkspace(null);
    useArticleStore.getState().reset();
    useReferenceStore.getState().reset();
    useUIStore.getState().reset();
    useSlashCommandStore.getState().reset();
    useSessionStore.getState().reset();

    set({ workspace: null, files: [], selectedFile: null });
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
      const { selectedFile } = get();
      if (selectedFile && selectedFile.path === itemPath) {
        set({ selectedFile: null });
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
