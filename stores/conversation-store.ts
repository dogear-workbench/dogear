import { create } from 'zustand';
import { client } from '@/lib/client';
import type { Conversation } from '@/components/BookConversationList';

// 分叉参数类型
interface ForkParams {
  sdkSessionIdToResume: string;
  forkSession: boolean;
  resumeSessionAt: string;
  editedMessage?: string;
  branchCount?: number;
  isForkNewConversation?: boolean;
}

interface ConversationState {
  // --- 状态 ---
  conversations: Conversation[];
  selectedConversation: Conversation | null;
  loadingConversations: boolean;
  forkParams: ForkParams | null;

  // --- Actions ---
  /** 加载工作区对话列表 */
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
}

/** 从 workspace-store 获取当前工作区 */
const getWorkspace = () => {
  const { useWorkspaceStore } = require('./workspace-store');
  return useWorkspaceStore.getState().workspace;
};

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  selectedConversation: null,
  loadingConversations: false,
  forkParams: null,

  loadConversations: async () => {
    const workspace = getWorkspace();
    if (!workspace) return;

    try {
      set({ loadingConversations: true });
      const result = await client.getByWorkspaceId({ workspaceId: workspace.id });
      if (result.error) {
        console.error('加载对话列表失败:', result.error);
        return;
      }
      set({ conversations: result.conversations || [] });
    } catch (error) {
      console.error('加载对话列表失败:', error);
    } finally {
      set({ loadingConversations: false });
    }
  },

  selectConversation: async (conversation) => {
    set({ forkParams: null, selectedConversation: conversation });

    // 如果对话有关联书籍，加载书籍信息
    const { useWorkspaceStore } = require('./workspace-store');
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
    const workspace = getWorkspace();
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
      const newConversation = await client.getById({ conversationId: result.conversationId });
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

    try {
      const result = await client.deleteConversation({ conversationId });
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
    try {
      // 获取父对话信息
      const convResult = await client.getById({ conversationId: params.parentConversationId });
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
      const newConvResult = await client.getById({ conversationId: forkResult.conversationId });
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

    try {
      const convResult = await client.getById({ conversationId: selectedConversation.id });
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
}));
