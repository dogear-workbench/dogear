import { create } from 'zustand';
import { RECENT_THRESHOLD_MS } from './group-store';
import { CONV_TREE_ROOT } from './conversation-store';

export interface FolderReveal {
  folderIds: string[];
  nonce: number;
}

interface SectionCollapseState {
  recentExpanded: boolean;
  folderReveal: FolderReveal | null;
  subExpandedConvIds: Set<string>;
  toggleRecent: () => void;
  toggleSubExpand: (convId: string) => void;
  expandSubConv: (convId: string) => void;
  revealTopic: (groupId: string) => Promise<void>;
}

let revealNonce = 0;

export const useSectionCollapseStore = create<SectionCollapseState>((set, get) => ({
  recentExpanded: true,
  folderReveal: null,
  subExpandedConvIds: new Set<string>(),

  toggleRecent: () => set((s) => ({ recentExpanded: !s.recentExpanded })),

  toggleSubExpand: (convId) => set((s) => {
    const next = new Set(s.subExpandedConvIds);
    if (next.has(convId)) next.delete(convId);
    else next.add(convId);
    return { subExpandedConvIds: next };
  }),

  expandSubConv: (convId) => {
    if (get().subExpandedConvIds.has(convId)) return;
    set((s) => {
      const next = new Set(s.subExpandedConvIds);
      next.add(convId);
      return { subExpandedConvIds: next };
    });
  },

  revealTopic: async (groupId) => {
    if (!groupId) return;
    const [{ useGroupStore }, { useWorkspaceStore }, { useConversationStore }] = await Promise.all([
      import('./group-store'),
      import('./workspace-store'),
      import('./conversation-store'),
    ]);

    const gs = useGroupStore.getState();
    const group = gs.groups.find((g) => g.id === groupId);
    if (!group) return;

    gs.expandGroup(groupId);

    if (Date.now() - group.updatedAt <= RECENT_THRESHOLD_MS) {
      if (!get().recentExpanded) set({ recentExpanded: true });
    }

    const ws = useWorkspaceStore.getState().workspace;
    const nodeMap = ws ? useConversationStore.getState().byWorkspace[ws.id]?.nodeMap ?? {} : {};
    const parentOf: Record<string, string> = {};
    for (const node of Object.values(nodeMap)) {
      for (const childId of node.childrenIds) parentOf[childId] = node.id;
    }
    const folderIds: string[] = [];
    let cur = parentOf[groupId];
    while (cur && cur !== CONV_TREE_ROOT && nodeMap[cur]?.nodeType === 'folder') {
      folderIds.unshift(cur);
      cur = parentOf[cur];
    }
    if (folderIds.length > 0) {
      set({ folderReveal: { folderIds, nonce: ++revealNonce } });
    }
  },
}));
