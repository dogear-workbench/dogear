import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { Group } from '@/types/group';

const getWorkspace = async () => {
  const { useWorkspaceStore } = await import('./workspace-store');
  return useWorkspaceStore.getState().workspace;
};

interface GroupState {
  groups: Group[];
  currentGroupId: string | null;
  expandedGroupIds: Set<string>;
  loading: boolean;

  load: (workspaceId: string) => Promise<void>;
  setCurrentGroup: (groupId: string | null) => void;
  toggleExpand: (groupId: string) => void;
  createGroup: (title?: string) => Promise<Group | null>;
  updateGroup: (groupId: string, patch: { title?: string }) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
}

export const useGroupStore = create<GroupState>((set) => ({
  groups: [],
  currentGroupId: null,
  expandedGroupIds: new Set<string>(),
  loading: false,

  load: async (workspaceId) => {
    set({ loading: true });
    try {
      const r = await client.listGroups({ workspaceId });
      set({ groups: r.groups ?? [], loading: false });
    } catch (e) {
      set({ loading: false });
      console.warn('[group-store] load 失败:', e);
    }
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

  createGroup: async (title) => {
    const workspace = await getWorkspace();
    if (!workspace) return null;
    try {
      const r = await client.createGroup({ workspaceId: workspace.id, title });
      if (r.error || !r.group) {
        toast.error('创建会话组失败', { description: r.error || '未知错误' });
        return null;
      }
      set((state) => ({ groups: [...state.groups, r.group!] }));
      return r.group;
    } catch (e) {
      toast.error('创建会话组失败', { description: e instanceof Error ? e.message : String(e) });
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

  deleteGroup: async (groupId) => {
    const workspace = await getWorkspace();
    if (!workspace) return;
    try {
      const r = await client.deleteGroup({ workspaceId: workspace.id, groupId });
      if (!r.ok) {
        toast.error('删除会话组失败', { description: r.error || '未知错误' });
        return;
      }
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== groupId),
        currentGroupId: state.currentGroupId === groupId ? null : state.currentGroupId,
      }));
    } catch (e) {
      console.error('删除会话组失败:', e);
    }
  },
}));
