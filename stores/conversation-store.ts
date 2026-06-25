import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import { useSessionStore } from '@/stores/session-store';
import type { Conversation } from '@/components/ConversationList';
import type { ConversationFolder, ConversationTreeData } from '@/types/electron-api';

// 分叉参数类型
export interface ForkParams {
  sdkSessionIdToResume: string;
  forkSession: boolean;
  resumeSessionAt: string;
  editedMessage?: string;
  /** 目标对话 ID，useAgentSession 仅处理与自身 conversationId 匹配的 forkParams */
  targetConversationId?: string;
}

/**
 * 跨 profile 切换模型后待续发的载荷：useSendMessage 在 needsRestart 分支塞入，
 * useAgentSession 在新 session ready 后按 conversationId 匹配消费。
 */
export interface PendingSendPayload {
  conversationId: string;
  content: string;
  textBlocks?: Array<{ text: string }>;
  images?: Array<{ media_type: string; data: string }>;
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

/**
 * 单个工作区的对话分片（里程碑 1.5 Phase 2 Step A2.2）
 * 切换工作区时顶层 conversations/selectedConversation/... 从对应分片镜像
 */
interface WorkspaceConversationSlice {
  conversations: Conversation[];
  selectedConversation: Conversation | null;
  treeData: ConversationTreeData | null;
  nodeMap: Record<string, ConversationFlatNode>;
  loadingConversations: boolean;
}

function emptySlice(): WorkspaceConversationSlice {
  return {
    conversations: [],
    selectedConversation: null,
    treeData: null,
    nodeMap: {},
    loadingConversations: false,
  };
}

interface ConversationState {
  // --- 按工作区分片的状态（唯一真源） ---
  byWorkspace: Record<string, WorkspaceConversationSlice>;
  /** 当前激活的工作区 id（顶层镜像字段指向它） */
  activeWorkspaceId: string | null;

  // --- 顶层镜像字段（从 byWorkspace[activeWorkspaceId] 同步，供选择器读取，保持现有调用点 API 不变） ---
  conversations: Conversation[];
  selectedConversation: Conversation | null;
  loadingConversations: boolean;
  treeData: ConversationTreeData | null;
  nodeMap: Record<string, ConversationFlatNode>;

  // --- 全局状态（跨工作区共享） ---
  forkParams: ForkParams | null;
  /** 会话重启触发器（递增时触发 useAgentSession 重建会话） */
  sessionRestartTrigger: number;
  /** 跨 profile 切换模型后待续发的载荷（useAgentSession 重启完成后自动消费） */
  pendingSendAfterRestart: PendingSendPayload | null;
  /** 当前正在运行（有 Agent 活跃）的对话 ID 集合 */
  runningConversationIds: Set<string>;
  /** 当前有待处理操作（权限/AskUser）的对话 ID 集合 */
  pendingActionConversationIds: Set<string>;
  /** 微信 Bot 当前绑定的对话 ID（null 表示未绑定） */
  botBoundConversationId: string | null;

  // --- Actions ---
  /** 切换激活工作区：把顶层镜像指向该工作区的分片（不触发加载） */
  activateWorkspace: (workspaceId: string | null) => void;
  /** 加载当前工作区对话列表和树数据（写入对应分片） */
  loadConversations: () => Promise<void>;
  /** 选择对话 */
  selectConversation: (conversation: Conversation) => Promise<void>;
  /** 按 id 聚焦对话（Tab 切换/关闭后同步左侧列表高亮），不重复打开 Tab；id 为 null 时清空选中 */
  focusConversationById: (conversationId: string | null) => Promise<void>;
  /** 新建对话 */
  newConversation: () => Promise<void>;
  /** 删除对话 */
  deleteConversation: (conversationId: string) => Promise<void>;
  /** 设置分叉参数 */
  setForkParams: (params: ForkParams | null) => void;
  /** 分叉对话（创建独立新对话） */
  forkConversation: (params: { parentConversationId: string; forkMessageSdkUuid: string }) => Promise<void>;
  /** 创建对话文件夹 */
  createFolder: (name: string, parentId?: string) => Promise<void>;
  /** 重命名对话文件夹 */
  renameFolder: (folderId: string, newName: string) => Promise<void>;
  /** 删除对话文件夹（子内容上移） */
  deleteFolder: (folderId: string) => Promise<void>;
  /** 移动对话或文件夹 */
  moveItem: (itemId: string, targetParentId: string, targetIndex?: number) => Promise<void>;
  /** 把对话添加到指定文件夹（多引用语义，不动其他文件夹）*/
  addConversationToFolder: (conversationId: string, folderId: string) => Promise<void>;
  /** 从指定文件夹移除（不动其他文件夹）*/
  removeConversationFromFolder: (conversationId: string, folderId: string) => Promise<void>;
  /** 在两个文件夹间移动（remove + add 原子）*/
  moveConversationBetweenFolders: (conversationId: string, fromFolderId: string, toFolderId: string) => Promise<void>;
  /** 更新对话标题 */
  updateConversationTitle: (conversationId: string, title: string) => Promise<void>;
  /** 更新对话的人设关联和临时提示词 */
  updateConversationPersona: (conversationId: string, personaId?: string, tempPrompt?: string) => Promise<void>;
  /** 更新对话的模型选择（null = 不指定） */
  setConversationModelSelection: (conversationId: string, selection: import('@/types/settings').ModelSelection | null) => Promise<void>;
  /** 更新对话的缓存策略（仅写库；切换是否需要重启会话由调用方处理） */
  setConversationCachePolicy: (conversationId: string, policy: '5m' | '1h') => Promise<void>;
  /** 触发会话重启 */
  triggerSessionRestart: () => void;
  /** 设置跨 profile 切换后的待续发载荷（null 表示清除） */
  setPendingSendAfterRestart: (payload: PendingSendPayload | null) => void;
  /** 设置对话运行状态 */
  setRunningState: (conversationId: string, isRunning: boolean) => void;
  /** 设置对话的待处理操作状态（权限/AskUser） */
  setPendingActionState: (conversationId: string, isPending: boolean) => void;
  /** 设置 Bot 绑定的对话 ID */
  setBotBoundConversation: (conversationId: string | null) => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

/** 从 workspace-store 获取当前工作区（延迟导入避免循环依赖） */
const getWorkspace = async () => {
  const { useWorkspaceStore } = await import('./workspace-store');
  return useWorkspaceStore.getState().workspace;
};

/**
 * 对 children 数组进行分区排序：文件夹在前，对话在后
 * 各分区内部保持原始数组顺序（即用户拖拽排定的顺序）
 */
function sortChildrenFoldersFirst(
  childIds: string[],
  folders: Record<string, ConversationFolder>,
): string[] {
  const folderIds: string[] = [];
  const conversationIds: string[] = [];
  for (const id of childIds) {
    if (folders[id]) {
      folderIds.push(id);
    } else {
      conversationIds.push(id);
    }
  }
  return [...folderIds, ...conversationIds];
}

/**
 * 构建对话树的扁平节点映射
 * 将对话列表和树数据合并为 @headless-tree/react 需要的格式
 */
function buildNodeMap(
  conversations: Conversation[],
  treeData: ConversationTreeData | null,
): Record<string, ConversationFlatNode> {
  const nodeMap: Record<string, ConversationFlatNode> = {};

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

  // 添加文件夹节点（子节点按文件夹优先排序）
  for (const folder of Object.values(treeData.folders)) {
    nodeMap[folder.id] = {
      id: folder.id,
      name: folder.name,
      isFolder: true,
      childrenIds: sortChildrenFoldersFirst(treeData.children[folder.id] || [], treeData.folders),
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

  // 根节点（文件夹优先排序）
  const rootChildren = treeData.children[CONV_TREE_ROOT] || [];
  nodeMap[CONV_TREE_ROOT] = {
    id: CONV_TREE_ROOT,
    name: 'root',
    isFolder: true,
    childrenIds: sortChildrenFoldersFirst([...orphanConvIds, ...rootChildren], treeData.folders),
    nodeType: 'folder',
  };

  return nodeMap;
}

/**
 * 工具函数：用 patch 更新指定工作区的分片，同时如果该工作区是当前激活则同步顶层镜像
 */
function patchSlice(
  state: ConversationState,
  workspaceId: string,
  patch: Partial<WorkspaceConversationSlice>,
): Partial<ConversationState> {
  const prev = state.byWorkspace[workspaceId] ?? emptySlice();
  const next = { ...prev, ...patch };
  const update: Partial<ConversationState> = {
    byWorkspace: { ...state.byWorkspace, [workspaceId]: next },
  };
  // 如果更新的是当前激活工作区，同步顶层镜像
  if (state.activeWorkspaceId === workspaceId) {
    Object.assign(update, patch);
  }
  return update;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  byWorkspace: {},
  activeWorkspaceId: null,

  // 顶层镜像字段初始值
  conversations: [],
  selectedConversation: null,
  loadingConversations: false,
  treeData: null,
  nodeMap: {},

  // 全局状态
  forkParams: null,
  sessionRestartTrigger: 0,
  pendingSendAfterRestart: null,
  runningConversationIds: new Set<string>(),
  pendingActionConversationIds: new Set<string>(),
  botBoundConversationId: null,

  activateWorkspace: (workspaceId) => {
    if (!workspaceId) {
      set({
        activeWorkspaceId: null,
        conversations: [],
        selectedConversation: null,
        loadingConversations: false,
        treeData: null,
        nodeMap: {},
      });
      return;
    }
    const slice = get().byWorkspace[workspaceId] ?? emptySlice();
    set({
      activeWorkspaceId: workspaceId,
      conversations: slice.conversations,
      selectedConversation: slice.selectedConversation,
      loadingConversations: slice.loadingConversations,
      treeData: slice.treeData,
      nodeMap: slice.nodeMap,
    });
  },

  loadConversations: async () => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;

    try {
      set((state) => patchSlice(state, wsId, { loadingConversations: true }));
      // 并行加载对话列表和树数据
      const [convResult, treeResult] = await Promise.all([
        client.getByWorkspaceId({ workspaceId: wsId }),
        client.getConversationTree({ workspaceId: wsId }),
      ]);

      const conversations = convResult.conversations || [];
      const treeData = treeResult.tree || null;
      const nodeMap = buildNodeMap(conversations, treeData);

      set((state) => patchSlice(state, wsId, { conversations, treeData, nodeMap }));
    } catch (error) {
      console.error('加载对话列表失败:', error);
    } finally {
      set((state) => patchSlice(state, wsId, { loadingConversations: false }));
    }

    void import('./group-store').then(({ useGroupStore }) => {
      useGroupStore.getState().load(wsId).catch(() => {});
    });
  },

  selectConversation: async (conversation) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;

    set((state) => ({ ...patchSlice(state, wsId, { selectedConversation: conversation }), forkParams: null }));

    // 自动打开标签页（openTab 内部有防重逻辑）
    useSessionStore.getState().openTab(conversation.id, conversation.title || '新对话', wsId);

    // 从后端获取最新数据，覆盖可能过时的前端缓存（如分叉字段已被清除）
    try {
      const fresh = await client.getById({ conversationId: conversation.id, workspaceId: wsId });
      if (fresh.conversation) {
        const freshConv = fresh.conversation;
        set((state) => {
          const slice = state.byWorkspace[wsId];
          if (slice?.selectedConversation?.id === conversation.id) {
            return patchSlice(state, wsId, { selectedConversation: freshConv });
          }
          return state;
        });
      }
    } catch { /* 忽略，已有缓存数据可用 */ }

    void import('./group-store').then(({ useGroupStore }) => {
      useGroupStore.getState().setCurrentGroup(conversation.groupId ?? null);
    });
  },

  focusConversationById: async (conversationId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;
    if (!conversationId) {
      set((state) => patchSlice(state, wsId, { selectedConversation: null }));
      return;
    }
    // 已是当前选中则跳过（避免重复 set 与多余请求）
    if (get().byWorkspace[wsId]?.selectedConversation?.id === conversationId) return;
    // 先从当前分片找；跨工作区切 Tab 时分片可能尚未加载，回退后端查询
    let conv = (get().byWorkspace[wsId]?.conversations ?? []).find((c) => c.id === conversationId) ?? null;
    if (!conv) {
      try {
        const fresh = await client.getById({ conversationId, workspaceId: wsId });
        conv = fresh.conversation ?? null;
      } catch { /* 查询失败则保持原选中 */ }
    }
    if (conv) {
      const selected = conv;
      set((state) => patchSlice(state, wsId, { selectedConversation: selected }));
    }
  },

  newConversation: async () => {
    const workspace = await getWorkspace();
    if (!workspace) return;

    try {
      const { useGroupStore } = await import('./group-store');
      const group = await useGroupStore.getState().createGroup();
      if (!group) return;

      const result = await client.create({ workspaceId: workspace.id, groupId: group.id });
      if (result.error || !result.conversationId) {
        toast.error('创建对话失败', { description: result.error || '未知错误' });
        return;
      }

      // 先获取新对话详情并选中（让 UI 立即响应）
      const newConversation = await client.getById({ conversationId: result.conversationId, workspaceId: workspace.id });
      if (newConversation.conversation) {
        get().selectConversation(newConversation.conversation);
      }

      // 后台刷新对话列表（不阻塞用户）
      get().loadConversations();
    } catch (error) {
      console.error('创建对话失败:', error);
      toast.error('创建对话失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  /**
   * 删除/归档对话（按 sdkSessionId 状态分流）
   * - 有 sdkSessionId（真实对话过）→ 归档（软删除，可恢复）
   * - 无 sdkSessionId（新建空对话 / 分叉未执行）→ 直接硬删除
   */
  deleteConversation: async (conversationId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;

    // 查找对话，判断走归档还是硬删除
    const slice = get().byWorkspace[wsId] ?? emptySlice();
    const target = slice.conversations.find(c => c.id === conversationId);
    const shouldArchive = !!target?.sdk_session_id;

    const confirmed = shouldArchive
      ? await showConfirm('归档对话', '对话将移至归档列表。你可以在侧边栏底部的"归档"中恢复或永久删除。')
      : await showConfirm('删除对话', '此对话尚未有内容，将直接删除。此操作不可恢复。');
    if (!confirmed) return;

    try {
      const result = shouldArchive
        ? await client.archiveConversation({ conversationId, workspaceId: wsId })
        : await client.deleteConversation({ conversationId, workspaceId: wsId });

      if (result.error) {
        toast.error(shouldArchive ? '归档对话失败' : '删除对话失败', { description: result.error });
        return;
      }

      // 关闭对应的 Tab
      useSessionStore.getState().closeTab(conversationId);

      // 如果操作的是当前选中的对话，清除选中状态
      const curSlice = get().byWorkspace[wsId];
      if (curSlice?.selectedConversation?.id === conversationId) {
        set((state) => patchSlice(state, wsId, { selectedConversation: null }));
      }

      await get().loadConversations();
    } catch (error) {
      console.error(shouldArchive ? '归档对话失败:' : '删除对话失败:', error);
      toast.error(shouldArchive ? '归档对话失败' : '删除对话失败', {
        description: error instanceof Error ? error.message : String(error),
      });
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
        toast.warning('该对话不支持分叉', { description: '缺少 SDK session' });
        return;
      }

      // 创建分叉对话记录
      const forkResult = await client.createFork({
        workspaceId: parentConv.workspace_id,
        title: `分叉自: ${parentConv.title}`,
        parentConversationId: params.parentConversationId,
        forkMessageSdkUuid: params.forkMessageSdkUuid,
      });

      if (forkResult.error || !forkResult.conversationId) {
        toast.error('创建分叉对话失败', { description: forkResult.error || '未知错误' });
        return;
      }

      // fork_pending 模式：不立即启动 SDK fork，等用户发送首条消息时再启动
      // 刷新对话列表
      await get().loadConversations();

      // 切换到新创建的分叉对话
      const newConvResult = await client.getById({ conversationId: forkResult.conversationId, workspaceId: workspace.id });
      if (newConvResult.conversation) {
        // 用 selectConversation 以打开标签页
        await get().selectConversation(newConvResult.conversation);
      }
    } catch (error) {
      console.error('分叉对话失败:', error);
      toast.error('分叉对话失败', { description: error instanceof Error ? error.message : String(error) });
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

  addConversationToFolder: async (conversationId, folderId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.addConversationToFolder({ workspaceId: workspace.id, conversationId, folderId });
      await get().loadConversations();
    } catch (error) {
      console.error('添加到文件夹失败:', error);
    }
  },

  removeConversationFromFolder: async (conversationId, folderId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.removeConversationFromFolder({ workspaceId: workspace.id, conversationId, folderId });
      await get().loadConversations();
    } catch (error) {
      console.error('从文件夹移除失败:', error);
    }
  },

  moveConversationBetweenFolders: async (conversationId, fromFolderId, toFolderId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.moveConversationBetweenFolders({ workspaceId: workspace.id, conversationId, fromFolderId, toFolderId });
      await get().loadConversations();
    } catch (error) {
      console.error('在文件夹间移动失败:', error);
    }
  },

  updateConversationTitle: async (conversationId, title) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;

    try {
      await client.updateTitle({ workspaceId: wsId, conversationId, title });

      // 同步更新 Tab 标题
      useSessionStore.getState().updateTitle(conversationId, title);

      // 更新分片状态
      set((state) => {
        const slice = state.byWorkspace[wsId] ?? emptySlice();
        const newConvs = slice.conversations.map((c) =>
          c.id === conversationId ? { ...c, title } : c
        );
        const newSelected = slice.selectedConversation?.id === conversationId
          ? { ...slice.selectedConversation, title }
          : slice.selectedConversation;
        const newNodeMap = Object.fromEntries(
          Object.entries(slice.nodeMap).map(([key, node]) =>
            key === conversationId
              ? [key, { ...node, name: title, conversation: node.conversation ? { ...node.conversation, title } : undefined }]
              : [key, node]
          )
        );
        return patchSlice(state, wsId, {
          conversations: newConvs,
          selectedConversation: newSelected,
          nodeMap: newNodeMap,
        });
      });
    } catch (error) {
      console.error('更新对话标题失败:', error);
    }
  },

  updateConversationPersona: async (conversationId, personaId, tempPrompt) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;

    try {
      await client.updateConversationPersona({
        workspaceId: wsId,
        conversationId,
        personaId,
        tempPrompt,
      });

      set((state) => {
        const slice = state.byWorkspace[wsId] ?? emptySlice();
        const newConvs = slice.conversations.map((c) =>
          c.id === conversationId ? { ...c, persona_id: personaId, temp_prompt: tempPrompt } : c
        );
        const newSelected = slice.selectedConversation?.id === conversationId
          ? { ...slice.selectedConversation, persona_id: personaId, temp_prompt: tempPrompt }
          : slice.selectedConversation;
        return patchSlice(state, wsId, {
          conversations: newConvs,
          selectedConversation: newSelected,
        });
      });
    } catch (error) {
      console.error('更新对话人设失败:', error);
    }
  },

  setConversationModelSelection: async (conversationId, selection) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;
    try {
      await client.setConversationModelSelection({
        workspaceId: wsId,
        conversationId,
        selection,
      });
      set((state) => {
        const slice = state.byWorkspace[wsId] ?? emptySlice();
        const newConvs = slice.conversations.map((c) =>
          c.id === conversationId ? { ...c, modelSelection: selection } : c
        );
        const newSelected = slice.selectedConversation?.id === conversationId
          ? { ...slice.selectedConversation, modelSelection: selection }
          : slice.selectedConversation;
        return patchSlice(state, wsId, {
          conversations: newConvs,
          selectedConversation: newSelected,
        });
      });
    } catch (error) {
      console.error('更新对话模型选择失败:', error);
    }
  },

  setConversationCachePolicy: async (conversationId, policy) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;
    try {
      await client.setConversationCachePolicy({
        workspaceId: wsId,
        conversationId,
        policy,
      });
      set((state) => {
        const slice = state.byWorkspace[wsId] ?? emptySlice();
        const newConvs = slice.conversations.map((c) =>
          c.id === conversationId ? { ...c, cachePolicy: policy } : c
        );
        const newSelected = slice.selectedConversation?.id === conversationId
          ? { ...slice.selectedConversation, cachePolicy: policy }
          : slice.selectedConversation;
        return patchSlice(state, wsId, {
          conversations: newConvs,
          selectedConversation: newSelected,
        });
      });
    } catch (error) {
      console.error('更新对话缓存策略失败:', error);
    }
  },

  triggerSessionRestart: () => {
    set((state) => ({ sessionRestartTrigger: state.sessionRestartTrigger + 1 }));
  },

  setPendingSendAfterRestart: (payload) => {
    set({ pendingSendAfterRestart: payload });
  },

  setRunningState: (conversationId: string, isRunning: boolean) => {
    set((state) => {
      const newSet = new Set(state.runningConversationIds);
      if (isRunning) newSet.add(conversationId);
      else newSet.delete(conversationId);
      return { runningConversationIds: newSet };
    });
  },

  setPendingActionState: (conversationId: string, isPending: boolean) => {
    set((state) => {
      const newSet = new Set(state.pendingActionConversationIds);
      if (isPending) newSet.add(conversationId);
      else newSet.delete(conversationId);
      return { pendingActionConversationIds: newSet };
    });
  },

  setBotBoundConversation: (conversationId: string | null) => {
    set({ botBoundConversationId: conversationId });
  },

  reset: () => set({
    byWorkspace: {},
    activeWorkspaceId: null,
    conversations: [],
    selectedConversation: null,
    loadingConversations: false,
    treeData: null,
    nodeMap: {},
    forkParams: null,
    sessionRestartTrigger: 0,
    pendingSendAfterRestart: null,
    runningConversationIds: new Set<string>(),
    pendingActionConversationIds: new Set<string>(),
    botBoundConversationId: null,
  }),
}));

// 监听主进程广播的对话运行状态、bot 绑定变更、对话列表变更
if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    // 对话运行状态变化
    rendererEvents.conversationRunningStateChanged.listen((data) => {
      useConversationStore.getState().setRunningState(data.conversationId, data.isRunning);
    });

    // 微信 Bot 绑定对话变更
    rendererEvents.wechatBotBindingChanged.listen((data) => {
      useConversationStore.getState().setBotBoundConversation(data.conversationId);
    });

    // 对话列表变更（bot 创建/删除对话后通知）
    rendererEvents.conversationListChanged.listen(() => {
      useConversationStore.getState().loadConversations();
    });
  });

  // Tab 焦点联动：activeTabId 变化（点 Tab/关 Tab 自动切/关其他/独立窗口收回等所有入口）
  // 时同步左侧对话列表的选中高亮，使「当前焦点会话」与列表高亮始终一致
  useSessionStore.subscribe((state, prev) => {
    if (state.activeTabId !== prev.activeTabId) {
      useConversationStore.getState().focusConversationById(state.activeTabId);
    }
  });

  // 初始化时查询 bot 绑定状态（避免页面刷新后丢失）
  import('@/lib/client').then(({ client }) => {
    client['wechat:getBotStatus'](undefined).then((data) => {
      if (data?.status?.conversationId) {
        useConversationStore.getState().setBotBoundConversation(data.status.conversationId);
      }
    }).catch(() => { /* bot 未连接时忽略 */ });
  });
}
