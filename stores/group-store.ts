import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { Group } from '@/types/group';

// 「近期」「更早」时间分区阈值，与侧边栏虚拟组共用；OLDER 与 auto-archive-service 的 30 天过期归档对齐
export const RECENT_THRESHOLD_MS = 7 * 86400_000;
export const OLDER_THRESHOLD_MS = 30 * 86400_000;

const getWorkspace = async () => {
  const { useWorkspaceStore } = await import('./workspace-store');
  return useWorkspaceStore.getState().workspace;
};

interface GroupState {
  groups: Group[];
  currentGroupId: string | null;
  expandedGroupIds: Set<string>;

  syncGroups: (workspaceId: string, groups: Group[]) => void;
  setCurrentGroup: (groupId: string | null) => void;
  toggleExpand: (groupId: string) => void;
  expandGroup: (groupId: string) => void;
  createGroup: (title?: string) => Promise<Group | null>;
  updateGroup: (groupId: string, patch: { title?: string }) => Promise<void>;
  archiveTopic: (groupId: string) => Promise<boolean>;
  restoreTopic: (groupId: string) => Promise<boolean>;
  deleteTopic: (groupId: string) => Promise<boolean>;
  deleteGroup: (groupId: string) => Promise<void>;
}

export const useGroupStore = create<GroupState>((set) => ({
  groups: [],
  currentGroupId: null,
  expandedGroupIds: new Set<string>(),

  syncGroups: (_workspaceId, groups) => {
    set({ groups });
  },

  setCurrentGroup: (groupId) => {
    set({ currentGroupId: groupId });
  },

  toggleExpand: (groupId) => {
    set((state) => {
      const next = new Set(state.expandedGroupIds);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return { expandedGroupIds: next };
    });
  },

  expandGroup: (groupId) => {
    set((state) => {
      if (state.expandedGroupIds.has(groupId)) return {};
      const next = new Set(state.expandedGroupIds);
      next.add(groupId);
      return { expandedGroupIds: next };
    });
  },

  createGroup: async (title) => {
    const workspace = await getWorkspace();
    if (!workspace) return null;
    try {
      const r = await client.createGroup({ workspaceId: workspace.id, title });
      if (r.error || !r.group) {
        toast.error('创建话题失败', { description: r.error || '未知错误' });
        return null;
      }
      set((state) => ({ groups: [...state.groups, r.group!] }));
      return r.group;
    } catch (e) {
      toast.error('创建话题失败', { description: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  updateGroup: async (groupId, patch) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      const r = await client.updateGroup({ workspaceId: workspace.id, groupId, patch });
      if (r.error || !r.group) return;
      const updated = r.group;
      set((state) => ({
        groups: state.groups.map((g) => (g.id === groupId ? updated : g)),
      }));
    } catch (e) {
      console.error('更新会话组失败:', e);
    }
  },

  archiveTopic: async (groupId) => {
    const workspace = await getWorkspace();
    if (!workspace) return false;
    try {
      const result = await client.archiveTopic({ workspaceId: workspace.id, groupId });
      if (result.error || !result.group) {
        toast.error('归档话题失败', { description: result.error || '未知错误' });
        return false;
      }
      set((state) => ({
        groups: state.groups.filter((group) => group.id !== groupId),
        currentGroupId: state.currentGroupId === groupId ? null : state.currentGroupId,
      }));
      const { useConversationStore } = await import('./conversation-store');
      await useConversationStore.getState().handleTopicStateChange(groupId, true);
      return true;
    } catch (error) {
      console.error('归档话题失败:', error);
      toast.error('归档话题失败', { description: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  restoreTopic: async (groupId) => {
    const workspace = await getWorkspace();
    if (!workspace) return false;
    try {
      const result = await client.restoreTopic({ workspaceId: workspace.id, groupId });
      if (result.error || !result.group) {
        toast.error('恢复话题失败', { description: result.error || '未知错误' });
        return false;
      }
      const restoredGroup = result.group;
      set((state) => ({
        groups: state.groups.some((group) => group.id === groupId)
          ? state.groups.map((group) => group.id === groupId ? restoredGroup : group)
          : [...state.groups, restoredGroup],
      }));
      const { useConversationStore } = await import('./conversation-store');
      await useConversationStore.getState().handleTopicStateChange(groupId, false);
      return true;
    } catch (error) {
      console.error('恢复话题失败:', error);
      toast.error('恢复话题失败', { description: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  deleteTopic: async (groupId) => {
    const workspace = await getWorkspace();
    if (!workspace) return false;
    try {
      const archivedTopics = await client.listArchivedTopics({ workspaceId: workspace.id }).catch(() => ({ topics: [] }));
      const archivedConversationIds = archivedTopics.topics
        ?.find((topic) => topic.group.id === groupId)
        ?.conversations.map((conversation) => conversation.id) ?? [];
      const result = await client.deleteTopic({ workspaceId: workspace.id, groupId });
      if (!result.ok) {
        toast.error('永久删除话题失败', { description: result.error || '未知错误' });
        return false;
      }
      set((state) => ({
        groups: state.groups.filter((group) => group.id !== groupId),
        currentGroupId: state.currentGroupId === groupId ? null : state.currentGroupId,
      }));
      const { useConversationStore } = await import('./conversation-store');
      await useConversationStore.getState().handleTopicStateChange(groupId, true, archivedConversationIds);
      return true;
    } catch (error) {
      console.error('永久删除话题失败:', error);
      toast.error('永久删除话题失败', { description: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  deleteGroup: async (groupId) => {
    await useGroupStore.getState().deleteTopic(groupId);
  },
}));
