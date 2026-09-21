import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import { useSessionStore } from '@/stores/session-store';
import type { Conversation } from '@/components/ConversationList';
import type { ConversationFolder, ConversationTreeData } from '@/types/electron-api';
import type { ChildStateSnapshot } from '@/types/delegation';
import type { Group } from '@/types/group';
import { PERSONAL_WORKSPACE_ID } from '@/types/workspace';

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

/**
 * newConversation 预 attach 的结果：让 useAgentSession 跳过重复 attach，直接复用。
 * 消费后清空。conversationId 用于校验是否匹配当前对话。
 */
export interface PreAttachedSession {
  conversationId: string;
  attachmentId: string;
  sessionId: string;
  permissionMode: import('@/types/electron-api').PermissionMode;
  snapshot: import('@/types/electron-api').ExtendedSessionMessage[];
  turnEntryIds: string[];
  pendingPermissionRequests: Array<{ requestId: string; toolName: string; toolInput: unknown }>;
  sessionState: { running: boolean; pendingAction: boolean; paused: boolean };
}

/** 对话树的扁平节点（供 @headless-tree/react 使用）。Phase 3：叶子节点装组而非对话。 */
export interface ConversationFlatNode {
  id: string;
  name: string;
  isFolder: boolean;
  childrenIds: string[];
  nodeType: 'group' | 'folder';
  group?: Group;
  folder?: ConversationFolder;
}

export const CONV_TREE_ROOT = '__root__';

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

/** 主会话模型故障转移提示（内存级，不写入会话持久层；刷新即失） */
export interface FailoverNotice {
  fromLabel: string;
  toLabel: string;
  at: number;
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

  // --- personal 临时会话（独立于工作区分片，所有工作区视图下常显） ---
  personalConversations: Conversation[];

  // --- 全局状态（跨工作区共享） ---
  /** 会话重启触发器（递增时触发 useAgentSession 重建会话） */
  sessionRestartTrigger: number;
  /** 跨 profile 切换模型后待续发的载荷（useAgentSession 重启完成后自动消费） */
  pendingSendAfterRestart: PendingSendPayload | null;
  /** newConversation 预 attach 的结果，useAgentSession 消费后清空 */
  preAttachedSession: PreAttachedSession | null;
  /** 当前正在运行（有 Agent 活跃）的对话 ID 集合 */
  runningConversationIds: Set<string>;
  /** 当前有待处理操作（权限/AskUser）的对话 ID 集合 */
  pendingActionConversationIds: Set<string>;
  /** 当前已暂停（turn 完成后暂停，发消息即恢复）的对话 ID 集合 */
  pausedConversationIds: Set<string>;
  /** 存活会话 ID 集合（主进程 PiSessionManager 内存态派生；全量广播直接替换） */
  aliveConversationIds: Set<string>;
  /** 微信 Bot 当前绑定的对话 ID（null 表示未绑定） */
  botBoundConversationId: string | null;
  /** bridge 暴露的子会话快照（按父会话 id 分组）。仅前端展示用，bridge 内存丢失后会被清空 */
  childrenByParent: Record<string, ChildStateSnapshot[]>;
  childSnapshotsById: Record<string, ChildStateSnapshot>;
  /** 主会话 failover 切换提示（按会话 id 分组，每会话仅保留最新一条） */
  failoverNoticesByConversation: Record<string, FailoverNotice[]>;
  /** failover 横幅自动过期时长（ms），测试可调 */
  failoverNoticeTtlMs: number;

  // --- Actions ---
  /** 切换激活工作区：把顶层镜像指向该工作区的分片（不触发加载） */
  activateWorkspace: (workspaceId: string | null) => void;
  /** 加载当前工作区对话列表和树数据（写入对应分片） */
  loadConversations: () => Promise<void>;
  /** 加载 personal 临时会话列表（独立存储，不随工作区切换） */
  loadPersonalConversations: () => Promise<void>;
  /** 新建临时会话：personal 单会话组两连调 + 预 attach + 开 tab 聚焦 */
  newPersonalConversation: () => Promise<void>;
  /** 把临时会话移入真实工作区；成功后切目标工作区、tab 原位改归属并聚焦 */
  movePersonalConversationToWorkspace: (
    conversationId: string,
    targetWorkspaceId: string,
    targetGroupId?: string,
    newGroupTitle?: string,
  ) => Promise<boolean>;
  /** 选择对话 */
  selectConversation: (conversation: Conversation) => Promise<void>;
  /** 按 id 聚焦对话（Tab 切换/关闭后同步左侧列表高亮），不重复打开 Tab；id 为 null 时清空选中 */
  focusConversationById: (conversationId: string | null) => Promise<void>;
  /** 新建对话 */
  newConversation: () => Promise<void>;
  /** 删除对话 */
  deleteConversation: (conversationId: string, workspaceId?: string) => Promise<void>;
  /** 话题归档、恢复或删除后的前端同步 */
  handleTopicStateChange: (groupId: string, closeTabs: boolean, conversationIds?: string[]) => Promise<void>;
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
  /** 把组添加到指定文件夹（多引用语义，不动其他文件夹）*/
  addGroupToFolder: (groupId: string, folderId: string) => Promise<void>;
  /** 从指定文件夹移除组（不动其他文件夹）*/
  removeGroupFromFolder: (groupId: string, folderId: string) => Promise<void>;
  /** 在两个文件夹间移动组（remove + add 原子）*/
  moveGroupBetweenFolders: (groupId: string, fromFolderId: string, toFolderId: string) => Promise<void>;
  /** 更新对话标题 */
  updateConversationTitle: (conversationId: string, title: string, workspaceId?: string) => Promise<void>;
  /** 更新对话的模型选择（null = 不指定） */
  setConversationModelSelection: (conversationId: string, selection: import('@/types/settings').ModelSelection | null) => Promise<void>;
  /** 触发会话重启 */
  triggerSessionRestart: () => void;
  /** 设置跨 profile 切换后的待续发载荷（null 表示清除） */
  setPendingSendAfterRestart: (payload: PendingSendPayload | null) => void;
  /** 设置预 attach 结果（null 表示清除） */
  setPreAttachedSession: (payload: PreAttachedSession | null) => void;
  /** 设置对话运行状态 */
  setRunningState: (conversationId: string, isRunning: boolean) => void;
  /** 设置对话的待处理操作状态（权限/AskUser） */
  setPendingActionState: (conversationId: string, isPending: boolean) => void;
  /** 设置对话的暂停状态 */
  setPausedState: (conversationId: string, isPaused: boolean) => void;
  /** 整体替换存活会话集合 */
  setAliveConversations: (conversationIds: string[]) => void;
  /** 设置 Bot 绑定的对话 ID */
  setBotBoundConversation: (conversationId: string | null) => void;
  /** 从 bridge 拉取所有子会话快照（loadConversations 后台调一次） */
  refreshAllChildren: () => Promise<void>;
  /** 把一条 childStatusChanged 事件应用到 childrenByParent */
  applyChildSnapshot: (snapshot: ChildStateSnapshot) => void;
  /** 追加一条 failover 切换提示（同一会话新切换覆盖旧条，仅保留最新一条；60s 自动过期） */
  pushFailoverNotice: (conversationId: string, notice: FailoverNotice) => void;
  /** 清除会话的 failover 切换提示（关闭按钮 / 自动过期） */
  dismissFailoverNotice: (conversationId: string, at: number) => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

/** 从 workspace-store 获取当前工作区（延迟导入避免循环依赖） */
const getWorkspace = async () => {
  const { useWorkspaceStore } = await import('./workspace-store');
  return useWorkspaceStore.getState().workspace;
};

/** 活跃会话切换时在左侧列表中定位话题：展开所在分区与话题卡片，让高亮可见 */
function revealTopicInList(groupId: string | null | undefined) {
  if (!groupId) return;
  void import('./section-collapse-store').then(({ useSectionCollapseStore }) => {
    useSectionCollapseStore.getState().revealTopic(groupId);
  });
}

/** 焦点会话是 agent 派出子会话时展开其父会话的折叠区，否则高亮会被折叠藏住 */
function expandSubParentIfNeeded(conv: Conversation, conversations: Conversation[]) {
  const meta = conv.contractMetadata;
  if (meta?.createdBy !== 'agent' || !meta.parentSessionId) return;
  const parent = conversations.find((c) => c.session_id === meta.parentSessionId);
  if (!parent) return;
  void import('./section-collapse-store').then(({ useSectionCollapseStore }) => {
    useSectionCollapseStore.getState().expandSubConv(parent.id);
  });
}

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
 * 构建对话树的扁平节点映射（Phase 3 组化后）。
 * - __root__ 只装 folderId
 * - 文件夹节点 childrenIds 装 groupId（filtered 到 group-store 已知组）
 * - 叶子节点为 group（每个 group 单独建一个 node）
 */
function buildNodeMap(
  groups: Group[],
  treeData: ConversationTreeData | null,
): Record<string, ConversationFlatNode> {
  const nodeMap: Record<string, ConversationFlatNode> = {};
  const groupById = new Map(groups.map((g) => [g.id, g]));

  // 1) 每个组建一个叶子节点
  for (const g of groups) {
    nodeMap[g.id] = {
      id: g.id,
      name: g.title || '(未命名话题)',
      isFolder: false,
      childrenIds: [],
      nodeType: 'group',
      group: g,
    };
  }

  if (!treeData) {
    nodeMap[CONV_TREE_ROOT] = {
      id: CONV_TREE_ROOT,
      name: 'root',
      isFolder: true,
      childrenIds: [],
      nodeType: 'folder',
    };
    return nodeMap;
  }

  // 2) 文件夹节点（childrenIds 过滤到现存组 + 嵌套子文件夹）
  for (const folder of Object.values(treeData.folders)) {
    const raw = treeData.children[folder.id] || [];
    const filtered = raw.filter((id) => treeData.folders[id] || groupById.has(id));
    nodeMap[folder.id] = {
      id: folder.id,
      name: folder.name,
      isFolder: true,
      childrenIds: sortChildrenFoldersFirst(filtered, treeData.folders),
      nodeType: 'folder',
      folder,
    };
  }

  // 3) 根节点：只保留 folderId
  const rootChildren = (treeData.children[CONV_TREE_ROOT] || []).filter((id) => treeData.folders[id]);
  nodeMap[CONV_TREE_ROOT] = {
    id: CONV_TREE_ROOT,
    name: 'root',
    isFolder: true,
    childrenIds: rootChildren,
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

  personalConversations: [],

  // 全局状态
  sessionRestartTrigger: 0,
  pendingSendAfterRestart: null,
  preAttachedSession: null,
  runningConversationIds: new Set<string>(),
  pendingActionConversationIds: new Set<string>(),
  pausedConversationIds: new Set<string>(),
  aliveConversationIds: new Set<string>(),
  botBoundConversationId: null,
  childrenByParent: {},
  childSnapshotsById: {},
  failoverNoticesByConversation: {},

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
      // 并行加载对话列表、树、组
      const [convResult, treeResult, groupsResult] = await Promise.all([
        client.getByWorkspaceId({ workspaceId: wsId }),
        client.getConversationTree({ workspaceId: wsId }),
        client.listGroups({ workspaceId: wsId }),
      ]);

      const conversations = convResult.conversations || [];
      const treeData = treeResult.tree || null;
      const groups = (groupsResult.groups || []) as Group[];
      const nodeMap = buildNodeMap(groups, treeData);

      set((state) => patchSlice(state, wsId, { conversations, treeData, nodeMap }));

      // 同步 group-store（避免组件分别拉取造成时序错位）
      void import('./group-store').then(({ useGroupStore }) => {
        useGroupStore.getState().syncGroups(wsId, groups);
      });
    } catch (error) {
      console.error('加载对话列表失败:', error);
    } finally {
      set((state) => patchSlice(state, wsId, { loadingConversations: false }));
    }

    // 后台拉子会话快照（bridge 内存态，非阻塞）
    void get().refreshAllChildren();
  },

  loadPersonalConversations: async () => {
    try {
      const result = await client.getByWorkspaceId({ workspaceId: PERSONAL_WORKSPACE_ID });
      set({ personalConversations: result.conversations ?? [] });
    } catch (error) {
      console.error('加载临时会话列表失败:', error);
    }
  },

  newPersonalConversation: async () => {
    try {
      const groupResult = await client.createGroup({ workspaceId: PERSONAL_WORKSPACE_ID, title: '' });
      if (groupResult.error || !groupResult.group) {
        toast.error('创建临时会话失败', { description: groupResult.error || '未知错误' });
        return;
      }
      const result = await client.create({ workspaceId: PERSONAL_WORKSPACE_ID, groupId: groupResult.group.id });
      if (result.error || !result.conversationId) {
        toast.error('创建临时会话失败', { description: result.error || '未知错误' });
        return;
      }
      const convResult = await client.getById({ conversationId: result.conversationId, workspaceId: PERSONAL_WORKSPACE_ID });
      if (!convResult.conversation) return;
      const conv = convResult.conversation;

      // 预 attach 消除 isSessionReady 窗口期，失败不阻断（useAgentSession effect 会重试正常 attach）
      try {
        const attachResult = await client.attachConversationRuntime({
          conversationId: conv.id,
          workspaceId: PERSONAL_WORKSPACE_ID,
        });
        if (!attachResult.error && attachResult.sessionId) {
          get().setPreAttachedSession({
            conversationId: conv.id,
            attachmentId: attachResult.attachmentId!,
            sessionId: attachResult.sessionId,
            permissionMode: (attachResult.permissionMode || 'default') as import('@/types/electron-api').PermissionMode,
            snapshot: (attachResult.snapshot ?? []) as import('@/types/electron-api').ExtendedSessionMessage[],
            turnEntryIds: attachResult.turnEntryIds ?? [],
            pendingPermissionRequests: attachResult.pendingPermissionRequests ?? [],
            sessionState: attachResult.sessionState ?? { running: false, pendingAction: false, paused: false },
          });
        }
      } catch {
        // 预 attach 失败不阻断流程
      }

      // 不写当前工作区分片/组状态（personal 平铺无组概念）；列表刷新走 conversationListChanged 广播回环
      void get().loadPersonalConversations();
      useSessionStore.getState().openTab(conv.id, conv.title || '新对话', PERSONAL_WORKSPACE_ID);
    } catch (error) {
      console.error('创建临时会话失败:', error);
      toast.error('创建临时会话失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  movePersonalConversationToWorkspace: async (conversationId, targetWorkspaceId, targetGroupId, newGroupTitle) => {
    try {
      const result = await client.moveConversationToWorkspace({
        conversationId,
        targetWorkspaceId,
        targetGroupId,
        newGroupTitle,
      });
      if (!result.ok) {
        toast.error('移入工作区失败', { description: result.error });
        return false;
      }

      // 先切后高亮：先切目标工作区（激活分片并拉列表），tab 原位改写归属后聚焦；
      // session 已被主进程关闭且 JSONL 换了目录，tab.workspaceId 变化驱动 useAgentSession 重 attach 到新路径
      const [{ workspaces }, { useWorkspaceStore }] = await Promise.all([
        client.getAll(),
        import('./workspace-store'),
      ]);
      const target = (workspaces ?? []).find((w) => w.id === targetWorkspaceId);
      if (target) await useWorkspaceStore.getState().setWorkspace(target);
      useSessionStore.getState().updateTabWorkspace(conversationId, targetWorkspaceId);
      await get().focusConversationById(conversationId);
      return true;
    } catch (error) {
      toast.error('移入工作区失败', { description: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  selectConversation: async (conversation) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;

    set((state) => patchSlice(state, wsId, { selectedConversation: conversation }));

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
    const curSlice = get().byWorkspace[wsId];
    const alreadySelected = curSlice?.selectedConversation?.id === conversationId;
    if (alreadySelected) {
      revealTopicInList(curSlice!.selectedConversation!.groupId);
      expandSubParentIfNeeded(curSlice!.selectedConversation!, curSlice?.conversations ?? []);
      return;
    }
    // 先从当前分片找；跨工作区切 Tab 时分片可能尚未加载，回退后端查询
    let conv = (curSlice?.conversations ?? []).find((c) => c.id === conversationId) ?? null;
    if (!conv) {
      try {
        const fresh = await client.getById({ conversationId, workspaceId: wsId });
        conv = fresh.conversation ?? null;
      } catch { /* 查询失败则保持原选中 */ }
    }
    if (conv) {
      const selected = conv;
      set((state) => patchSlice(state, wsId, { selectedConversation: selected }));
      revealTopicInList(selected.groupId);
      expandSubParentIfNeeded(selected, curSlice?.conversations ?? []);
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

      // 预 attach：在 selectConversation 前初始化 session，消除 isSessionReady 窗口期。
      // useAgentSession effect 触发时检测到 preAttachedSession 直接复用，不重复 attach。
      try {
        const attachResult = await client.attachConversationRuntime({
          conversationId: result.conversationId,
          workspaceId: workspace.id,
        });
        if (!attachResult.error && attachResult.sessionId) {
          get().setPreAttachedSession({
            conversationId: result.conversationId,
            attachmentId: attachResult.attachmentId!,
            sessionId: attachResult.sessionId,
            permissionMode: (attachResult.permissionMode || 'default') as import('@/types/electron-api').PermissionMode,
            snapshot: (attachResult.snapshot ?? []) as import('@/types/electron-api').ExtendedSessionMessage[],
            turnEntryIds: attachResult.turnEntryIds ?? [],
            pendingPermissionRequests: attachResult.pendingPermissionRequests ?? [],
            sessionState: attachResult.sessionState ?? { running: false, pendingAction: false, paused: false },
          });
        }
      } catch {
        // 预 attach 失败不阻断流程，useAgentSession effect 会重试正常 attach
      }

      // 先获取新对话详情并选中（让 UI 立即响应；列表刷新由 conversationListChanged 事件回环）
      const newConversation = await client.getById({ conversationId: result.conversationId, workspaceId: workspace.id });
      if (newConversation.conversation) {
        get().selectConversation(newConversation.conversation);
      }
    } catch (error) {
      console.error('创建对话失败:', error);
      toast.error('创建对话失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  deleteConversation: async (conversationId, workspaceIdOverride) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspaceIdOverride ?? workspace.id;

    const confirmed = await showConfirm('删除对话', '将永久删除该对话及其所有历史记录。此操作不可恢复。');
    if (!confirmed) return;

    try {
      const result = await client.deleteConversation({ conversationId, workspaceId: wsId });
      if (result.error) {
        toast.error('删除对话失败', { description: result.error });
        return;
      }

      useSessionStore.getState().closeTab(conversationId);
      if (wsId === workspace.id) {
        const curSlice = get().byWorkspace[wsId];
        if (curSlice?.selectedConversation?.id === conversationId) {
          set((state) => patchSlice(state, wsId, { selectedConversation: null }));
        }
      } else {
        void get().loadPersonalConversations();
      }
    } catch (error) {
      console.error('删除对话失败:', error);
      toast.error('删除对话失败', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  },

  handleTopicStateChange: async (groupId, closeTabs, topicConversationIds = []) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspace.id;
    const slice = get().byWorkspace[wsId] ?? emptySlice();
    const conversationIds = new Set([
      ...topicConversationIds,
      ...slice.conversations
        .filter((conversation) => conversation.groupId === groupId)
        .map((conversation) => conversation.id),
    ]);

    if (closeTabs) {
      for (const conversationId of conversationIds) {
        useSessionStore.getState().closeTab(conversationId);
      }
      const selected = slice.selectedConversation;
      if (selected?.groupId === groupId) {
        set((state) => patchSlice(state, wsId, { selectedConversation: null }));
      }
    }
  },

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

      if (!parentConv.session_id) {
        toast.warning('该对话不支持分叉', { description: '尚未创建会话' });
        return;
      }

      // 创建分叉对话记录：后端同步完成 Harness fork，返回时新对话已可直接恢复
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

      // 切换到新创建的分叉对话（列表刷新由 conversationListChanged 事件回环）
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
    } catch (error) {
      console.error('创建文件夹失败:', error);
    }
  },

  renameFolder: async (folderId, newName) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.renameConversationFolder({ workspaceId: workspace.id, folderId, name: newName });
    } catch (error) {
      console.error('重命名文件夹失败:', error);
    }
  },

  deleteFolder: async (folderId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.deleteConversationFolder({ workspaceId: workspace.id, folderId });
    } catch (error) {
      console.error('删除文件夹失败:', error);
    }
  },

  moveItem: async (itemId, targetParentId, targetIndex) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.moveConversationItem({ workspaceId: workspace.id, itemId, targetParentId, targetIndex });
    } catch (error) {
      console.error('移动失败:', error);
    }
  },

  addGroupToFolder: async (groupId, folderId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.addGroupToFolder({ workspaceId: workspace.id, groupId, folderId });
    } catch (error) {
      console.error('添加组到文件夹失败:', error);
    }
  },

  removeGroupFromFolder: async (groupId, folderId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.removeGroupFromFolder({ workspaceId: workspace.id, groupId, folderId });
    } catch (error) {
      console.error('从文件夹移除组失败:', error);
    }
  },

  moveGroupBetweenFolders: async (groupId, fromFolderId, toFolderId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      await client.moveGroupBetweenFolders({ workspaceId: workspace.id, groupId, fromFolderId, toFolderId });
    } catch (error) {
      console.error('在文件夹间移动组失败:', error);
    }
  },

  updateConversationTitle: async (conversationId, title, workspaceIdOverride) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    const wsId = workspaceIdOverride ?? workspace.id;

    try {
      await client.updateTitle({ workspaceId: wsId, conversationId, title });

      // 同步更新 Tab 标题
      useSessionStore.getState().updateTitle(conversationId, title);

      // personal 侧分片不存在，列表刷新走广播回环
      if (wsId !== workspace.id) return;

      // 更新分片状态（nodeMap 装组，不需要按 conversationId 改）
      set((state) => {
        const slice = state.byWorkspace[wsId] ?? emptySlice();
        const newConvs = slice.conversations.map((c) =>
          c.id === conversationId ? { ...c, title } : c
        );
        const newSelected = slice.selectedConversation?.id === conversationId
          ? { ...slice.selectedConversation, title }
          : slice.selectedConversation;
        return patchSlice(state, wsId, {
          conversations: newConvs,
          selectedConversation: newSelected,
        });
      });
    } catch (error) {
      console.error('更新对话标题失败:', error);
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

  triggerSessionRestart: () => {
    set((state) => ({ sessionRestartTrigger: state.sessionRestartTrigger + 1 }));
  },

  setPendingSendAfterRestart: (payload) => {
    set({ pendingSendAfterRestart: payload });
  },

  setPreAttachedSession: (payload) => {
    set({ preAttachedSession: payload });
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

  setPausedState: (conversationId: string, isPaused: boolean) => {
    set((state) => {
      const newSet = new Set(state.pausedConversationIds);
      if (isPaused) newSet.add(conversationId);
      else newSet.delete(conversationId);
      return { pausedConversationIds: newSet };
    });
  },

  setAliveConversations: (conversationIds: string[]) => {
    set({ aliveConversationIds: new Set(conversationIds) });
  },

  setBotBoundConversation: (conversationId: string | null) => {
    set({ botBoundConversationId: conversationId });
  },

  refreshAllChildren: async () => {
    try {
      const result = await client.listAllChildren(undefined);
      const grouped: Record<string, ChildStateSnapshot[]> = {};
      const byId: Record<string, ChildStateSnapshot> = {};
      for (const snap of result.children ?? []) {
        const arr = grouped[snap.parentConversationId] ?? [];
        arr.push(snap);
        grouped[snap.parentConversationId] = arr;
        byId[snap.childId] = snap;
      }
      for (const arr of Object.values(grouped)) {
        arr.sort((a, b) => a.startedAt - b.startedAt);
      }
      set({ childrenByParent: grouped, childSnapshotsById: byId });
    } catch (error) {
      console.error('拉取子会话快照失败:', error);
    }
  },

  applyChildSnapshot: (snapshot) => {
    set((state) => {
      const parentId = snapshot.parentConversationId;
      const list = state.childrenByParent[parentId] ?? [];
      const idx = list.findIndex((s) => s.childId === snapshot.childId);
      const next = idx >= 0
        ? list.map((s, i) => (i === idx ? snapshot : s))
        : [...list, snapshot].sort((a, b) => a.startedAt - b.startedAt);
      return {
        childrenByParent: { ...state.childrenByParent, [parentId]: next },
        childSnapshotsById: { ...state.childSnapshotsById, [snapshot.childId]: snapshot },
      };
    });
  },

  /** failover 横幅存活时长：到期自动清除（测试可注入更短值） */
  failoverNoticeTtlMs: 60_000,

  pushFailoverNotice: (conversationId, notice) => {
    set((state) => ({
      failoverNoticesByConversation: { ...state.failoverNoticesByConversation, [conversationId]: [notice] },
    }));
    setTimeout(() => {
      useConversationStore.getState().dismissFailoverNotice(conversationId, notice.at);
    }, useConversationStore.getState().failoverNoticeTtlMs);
  },

  dismissFailoverNotice: (conversationId, at) => {
    set((state) => {
      const list = state.failoverNoticesByConversation[conversationId];
      if (!list || !list.some((n) => n.at === at)) return state;
      const next = { ...state.failoverNoticesByConversation };
      const rest = list.filter((n) => n.at !== at);
      if (rest.length === 0) delete next[conversationId];
      else next[conversationId] = rest;
      return { failoverNoticesByConversation: next };
    });
  },

  reset: () => set({
    byWorkspace: {},
    activeWorkspaceId: null,
    conversations: [],
    selectedConversation: null,
    loadingConversations: false,
    treeData: null,
    nodeMap: {},
    personalConversations: [],
    sessionRestartTrigger: 0,
    pendingSendAfterRestart: null,
    preAttachedSession: null,
    runningConversationIds: new Set<string>(),
    pendingActionConversationIds: new Set<string>(),
    pausedConversationIds: new Set<string>(),
    aliveConversationIds: new Set<string>(),
    botBoundConversationId: null,
    childrenByParent: {},
    childSnapshotsById: {},
    failoverNoticesByConversation: {},
    failoverNoticeTtlMs: 60_000,
  }),
}));

// 监听主进程广播的对话运行状态、bot 绑定变更、对话列表变更
if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    // 会话运行/挂起状态变化（跑步机模式：后端唯一权威判定，同一次事件同步更新 running/pendingAction 两个 Set）
    rendererEvents.sessionStateChanged.listen((data) => {
      useConversationStore.getState().setRunningState(data.conversationId, data.running);
      useConversationStore.getState().setPendingActionState(data.conversationId, data.pendingAction);
      useConversationStore.getState().setPausedState(data.conversationId, data.paused);
    });

    // 会话已终止：running/pendingAction 都清零，不再等待对应的 sessionStateChanged:false
    rendererEvents.sessionClosed.listen((data) => {
      useConversationStore.getState().setRunningState(data.conversationId, false);
      useConversationStore.getState().setPendingActionState(data.conversationId, false);
      useConversationStore.getState().setPausedState(data.conversationId, false);
    });

    // 存活会话集合（全量广播直接替换，无 UI 也活着/正在跑的后台链路）
    rendererEvents.aliveConversationsChanged.listen((data) => {
      useConversationStore.getState().setAliveConversations(data.conversationIds);
    });

    // 微信 Bot 绑定对话变更
    rendererEvents.wechatBotBindingChanged.listen((data) => {
      useConversationStore.getState().setBotBoundConversation(data.conversationId);
    });

    // 对话列表变更（bot 创建/删除对话后通知）；personal 侧写点广播带 workspaceId=personal，路由到独立列表
    rendererEvents.conversationListChanged.listen((data) => {
      useConversationStore.getState().loadConversations();
      if (data?.workspaceId === PERSONAL_WORKSPACE_ID) {
        void useConversationStore.getState().loadPersonalConversations();
      }
    });

    // 子会话状态变化（delegation-bridge → applyChildSnapshot）
    rendererEvents.childStatusChanged.listen((data) => {
      useConversationStore.getState().applyChildSnapshot(data.snapshot);
    });

    // 主会话 failover 切换提示（model-failover → pushFailoverNotice）。
    // failover 在主进程换了 sessionId 重建 session，渲染层必须重 attach 才能续接流式事件
    rendererEvents.failoverNotice.listen((data) => {
      useConversationStore.getState().pushFailoverNotice(data.conversationId, {
        fromLabel: data.fromLabel,
        toLabel: data.toLabel,
        at: data.at,
      });
      useConversationStore.getState().triggerSessionRestart();
    });
  });

  // Tab 焦点联动：activeTabId 变化（点 Tab/关 Tab 自动切/关其他/独立窗口收回等所有入口）时，
  // 若焦点 tab 属于其他工作区须先 await setWorkspace 再 focusConversationById——先高亮会用旧工作区分片查丢会话
  useSessionStore.subscribe((state, prev) => {
    if (state.activeTabId === prev.activeTabId) return;
    const tabId = state.activeTabId;
    void (async () => {
      const { useWorkspaceStore } = await import('./workspace-store');
      const tab = tabId ? useSessionStore.getState().getTab(tabId) : undefined;
      // 全局焦点上报：真实会话 tab 才上报（哨兵/空 tab 不上报，保持最近焦点语义），fire-and-forget 失败静默
      if (tab) {
        void client.setFocusedConversation({ conversationId: tabId!, workspaceId: tab.workspaceId }).catch(() => {});
      }
      const currentWsId = useWorkspaceStore.getState().workspace?.id;
      if (tab?.workspaceId && tab.workspaceId !== currentWsId) {
        try {
          const { workspaces } = await client.getAll();
          if (useSessionStore.getState().activeTabId !== tabId) return;
          const target = workspaces?.find((w) => w.id === tab.workspaceId);
          if (target) await useWorkspaceStore.getState().setWorkspace(target);
        } catch (err) {
          console.error('[焦点联动] 切换工作区失败:', err);
        }
      }
      useConversationStore.getState().focusConversationById(tabId);
    })();
  });

  // 初始化时查询 bot 绑定状态（避免页面刷新后丢失）
  import('@/lib/client').then(({ client }) => {
    client['wechat:getBotStatus'](undefined).then((data) => {
      if (data?.status?.conversationId) {
        useConversationStore.getState().setBotBoundConversation(data.status.conversationId);
      }
    }).catch(() => { /* bot 未连接时忽略 */ });

    // 存活集合初值：窗口冷启动/刷新时主进程不会重播事件，主动拉一次全量
    client.getAliveConversations(undefined).then((data) => {
      useConversationStore.getState().setAliveConversations(data.conversationIds ?? []);
    }).catch(() => { /* 拉取失败等下次广播修正 */ });

    // personal 临时会话列表：启动拉一次，后续由 conversationListChanged 广播驱动
    useConversationStore.getState().loadPersonalConversations();
  });
}
