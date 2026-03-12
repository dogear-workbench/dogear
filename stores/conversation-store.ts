import { create } from 'zustand';
import { client } from '@/lib/client';
import type { Conversation } from '@/components/BookConversationList';
import type { ConversationFolder, ConversationTreeData } from '@/types/electron-api';

// 分叉参数类型
export interface ForkParams {
  sdkSessionIdToResume: string;
  forkSession: boolean;
  resumeSessionAt: string;
  editedMessage?: string;
  branchCount?: number;
  isForkNewConversation?: boolean;
}

/** 对话树的扁平节点（供 @headless-tree/react 使用） */
export interface ConversationFlatNode {
  id: string;
  name: string;
  isFolder: boolean;
  childrenIds: string[];
  nodeType: 'conversation' | 'folder';
  conversation?: Conversation;
  folder?: ConversationFolder;
}

const CONV_TREE_ROOT = '__root__';

interface ConversationState {
  // --- 状态 ---
  conversations: Conversation[];
  selectedConversation: Conversation | null;
  loadingConversations: boolean;
  forkParams: ForkParams | null;
  treeData: ConversationTreeData | null;
  nodeMap: Record<string, ConversationFlatNode>;

  // --- Actions ---
  /** 加载工作区对话列表和树数据 */
  loadConversations: () => Promise<void>;
  /** 选择对话 */
  selectConversation: (conversation: Conversation) => Promise<void>;
  /** 新建对话 */
  newConversation: () => Promise<void>;
  /** 删除对话 */
  deleteConversation: (conversationId: string) => Promise<void>;
  /** 设置分叉参数 */
  setForkParams: (params: ForkParams | null) => void;
  /** 分叉对话（创建独立新对话） */
  forkConversation: (params: { parentConversationId: string; forkMessageSdkUuid: string }) => Promise<void>;
  /** 编辑重发（当前对话内分支） */
  editResend: (params: { forkPointSdkUuid: string; editedMessage: string }) => Promise<void>;
  /** 创建对话文件夹 */
  createFolder: (name: string, parentId?: string) => Promise<void>;
  /** 重命名对话文件夹 */
  renameFolder: (folderId: string, newName: string) => Promise<void>;
  /** 删除对话文件夹（子内容上移） */
  deleteFolder: (folderId: string) => Promise<void>;
  /** 移动对话或文件夹 */
  moveItem: (itemId: string, targetParentId: string, targetIndex?: number) => Promise<void>;
}

/** 从 workspace-store 获取当前工作区（延迟导入避免循环依赖） */
const getWorkspace = async () => {
  const { useWorkspaceStore } = await import('./workspace-store');
  return useWorkspaceStore.getState().workspace;
};

/**
 * 构建对话树的扁平节点映射
 * 将对话列表和树数据合并为 @headless-tree/react 需要的格式
 */
function buildNodeMap(
  conversations: Conversation[],
  treeData: ConversationTreeData | null,
): Record<string, ConversationFlatNode> {
  const nodeMap: Record<string, ConversationFlatNode> = {};
  const convMap = new Map(conversations.map(c => [c.id, c]));

  if (!treeData) {
    // 无树数据，所有对话平铺到根
    nodeMap[CONV_TREE_ROOT] = {
      id: CONV_TREE_ROOT,
      name: 'root',
      isFolder: true,
      childrenIds: conversations.map(c => c.id),
      nodeType: 'folder',
    };
    for (const conv of conversations) {
      nodeMap[conv.id] = {
        id: conv.id,
        name: conv.title || '新对话',
        isFolder: false,
        childrenIds: [],
        nodeType: 'conversation',
        conversation: conv,
      };
    }
    return nodeMap;
  }

  // 添加文件夹节点
  for (const folder of Object.values(treeData.folders)) {
    nodeMap[folder.id] = {
      id: folder.id,
      name: folder.name,
      isFolder: true,
      childrenIds: treeData.children[folder.id] || [],
      nodeType: 'folder',
      folder,
    };
  }

  // 添加对话节点
  for (const conv of conversations) {
    nodeMap[conv.id] = {
      id: conv.id,
      name: conv.title || '新对话',
      isFolder: false,
      childrenIds: [],
      nodeType: 'conversation',
      conversation: conv,
    };
  }

  // 处理不在树中的孤儿对话（迁移遗漏或手动创建的）
  const allTreeIds = new Set<string>();
  for (const childIds of Object.values(treeData.children)) {
    for (const id of childIds) allTreeIds.add(id);
  }
  const orphanConvIds = conversations
    .filter(c => !allTreeIds.has(c.id))
    .map(c => c.id);

  // 根节点
  const rootChildren = treeData.children[CONV_TREE_ROOT] || [];
  nodeMap[CONV_TREE_ROOT] = {
    id: CONV_TREE_ROOT,
    name: 'root',
    isFolder: true,
    childrenIds: [...orphanConvIds, ...rootChildren],
    nodeType: 'folder',
  };

  return nodeMap;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  selectedConversation: null,
  loadingConversations: false,
  forkParams: null,
  treeData: null,
  nodeMap: {},

  loadConversations: async () => {
    const workspace = await getWorkspace();
    if (!workspace) return;

    try {
      set({ loadingConversations: true });
      // 并行加载对话列表和树数据
      const [convResult, treeResult] = await Promise.all([
        client.getByWorkspaceId({ workspaceId: workspace.id }),
        client.getConversationTree({ workspaceId: workspace.id }),
      ]);

      const conversations = convResult.conversations || [];
      const treeData = treeResult.tree || null;
      const nodeMap = buildNodeMap(conversations, treeData);

      set({ conversations, treeData, nodeMap });
    } catch (error) {
      console.error('加载对话列表失败:', error);
    } finally {
      set({ loadingConversations: false });
    }
  },

  selectConversation: async (conversation) => {
    set({ forkParams: null, selectedConversation: conversation });

    // 如果对话有关联书籍，加载书籍信息
    const { useWorkspaceStore } = await import('./workspace-store');
    if (conversation.book_id) {
      try {
        const book = await client.getBookByFilePath({ filePathOrBookId: conversation.book_id });
        useWorkspaceStore.getState().setSelectedBook(book || null);
      } catch (error) {
        console.error('获取书籍信息失败:', error);
        useWorkspaceStore.getState().setSelectedBook(null);
      }
    } else {
      useWorkspaceStore.getState().setSelectedBook(null);
    }
  },

  newConversation: async () => {
    const workspace = await getWorkspace();
    if (!workspace) return;

    try {
      const result = await client.create({ workspaceId: workspace.id });
      if (result.error || !result.conversationId) {
        alert(`创建对话失败: ${result.error || '未知错误'}`);
        return;
      }

      // 重新加载对话列表
      await get().loadConversations();

      // 选中新创建的对话
      const newConversation = await client.getById({ conversationId: result.conversationId, workspaceId: workspace.id });
      if (newConversation.conversation) {
        get().selectConversation(newConversation.conversation);
      }
    } catch (error) {
      console.error('创建对话失败:', error);
      alert(`创建对话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  deleteConversation: async (conversationId) => {
    if (!confirm('确定要删除这个对话吗？此操作不可恢复。')) return;

    const workspace = await getWorkspace();
    if (!workspace) return;

    try {
      const result = await client.deleteConversation({ conversationId, workspaceId: workspace.id });
      if (result.error) {
        alert(`删除失败: ${result.error}`);
        return;
      }

      // 如果删除的是当前选中的对话，清除选中状态
      if (get().selectedConversation?.id === conversationId) {
        set({ selectedConversation: null });
      }

      await get().loadConversations();
    } catch (error) {
      console.error('删除对话失败:', error);
      alert(`删除失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  setForkParams: (params) => set({ forkParams: params }),

  forkConversation: async (params) => {
    const workspace = await getWorkspace();
    if (!workspace) return;

    try {
      // 获取父对话信息
      const convResult = await client.getById({ conversationId: params.parentConversationId, workspaceId: workspace.id });
      const parentConv = convResult.conversation;

      if (!parentConv) {
        console.error('父对话不存在');
        return;
      }

      if (!parentConv.sdk_session_id) {
        alert('该对话不支持分叉（缺少 SDK session）');
        return;
      }

      // 创建分叉对话记录
      const forkResult = await client.createFork({
        workspaceId: parentConv.workspace_id,
        title: `分叉自: ${parentConv.title}`,
        parentConversationId: params.parentConversationId,
        forkMessageSdkUuid: params.forkMessageSdkUuid,
        bookId: parentConv.book_id,
      });

      if (forkResult.error || !forkResult.conversationId) {
        alert(`创建分叉对话失败: ${forkResult.error || '未知错误'}`);
        return;
      }

      // 设置 forkParams，让 AgentChat 以 fork 模式启动
      set({
        forkParams: {
          sdkSessionIdToResume: parentConv.sdk_session_id,
          forkSession: true,
          resumeSessionAt: params.forkMessageSdkUuid,
          isForkNewConversation: true,
        },
      });

      // 刷新对话列表
      await get().loadConversations();

      // 切换到新创建的分叉对话
      const newConvResult = await client.getById({ conversationId: forkResult.conversationId, workspaceId: workspace.id });
      if (newConvResult.conversation) {
        set({ selectedConversation: newConvResult.conversation });
      }
    } catch (error) {
      console.error('分叉对话失败:', error);
      alert(`分叉对话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  editResend: async (params) => {
    const { selectedConversation } = get();
    if (!selectedConversation?.id) return;

    const workspace = await getWorkspace();
    if (!workspace) return;

    try {
      const convResult = await client.getById({ conversationId: selectedConversation.id, workspaceId: workspace.id });
      const conv = convResult.conversation;

      if (!conv?.sdk_session_id) {
        alert('该对话不支持编辑重发（缺少 SDK session）');
        return;
      }

      // 使用 resume + resumeSessionAt 截断（不创建分支）
      set({
        forkParams: {
          sdkSessionIdToResume: conv.sdk_session_id,
          forkSession: false,  // 不创建新会话，直接截断重写
          resumeSessionAt: params.forkPointSdkUuid,
          editedMessage: params.editedMessage,
        },
      });
    } catch (error) {
      console.error('编辑重发失败:', error);
      alert(`编辑重发失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  createFolder: async (name, parentId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.createConversationFolder({ workspaceId: workspace.id, name, parentId });
      await get().loadConversations();
    } catch (error) {
      console.error('创建文件夹失败:', error);
    }
  },

  renameFolder: async (folderId, newName) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.renameConversationFolder({ workspaceId: workspace.id, folderId, name: newName });
      await get().loadConversations();
    } catch (error) {
      console.error('重命名文件夹失败:', error);
    }
  },

  deleteFolder: async (folderId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.deleteConversationFolder({ workspaceId: workspace.id, folderId });
      await get().loadConversations();
    } catch (error) {
      console.error('删除文件夹失败:', error);
    }
  },

  moveItem: async (itemId, targetParentId, targetIndex) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.moveConversationItem({ workspaceId: workspace.id, itemId, targetParentId, targetIndex });
      await get().loadConversations();
    } catch (error) {
      console.error('移动失败:', error);
    }
  },
}));
