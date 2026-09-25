import { create } from 'zustand';
import { RECENT_THRESHOLD_MS, OLDER_THRESHOLD_MS } from './group-store';

interface SectionCollapseState {
  recentExpanded: boolean;
  olderExpanded: boolean;
  personalOlderExpanded: boolean;
  subExpandedConvIds: Set<string>;
  toggleRecent: () => void;
  toggleOlder: () => void;
  togglePersonalOlder: () => void;
  toggleSubExpand: (convId: string) => void;
  expandSubConv: (convId: string) => void;
  revealTopic: (groupId: string) => Promise<void>;
}

export const useSectionCollapseStore = create<SectionCollapseState>((set, get) => ({
  recentExpanded: true,
  olderExpanded: false,
  personalOlderExpanded: false,
  subExpandedConvIds: new Set<string>(),

  toggleRecent: () => set((s) => ({ recentExpanded: !s.recentExpanded })),

  toggleOlder: () => set((s) => ({ olderExpanded: !s.olderExpanded })),

  togglePersonalOlder: () => set((s) => ({ personalOlderExpanded: !s.personalOlderExpanded })),

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
    const { useGroupStore } = await import('./group-store');

    const gs = useGroupStore.getState();
    const group = gs.groups.find((g) => g.id === groupId);
    if (!group) return;

    gs.expandGroup(groupId);

    const age = Date.now() - group.updatedAt;
    if (age <= RECENT_THRESHOLD_MS) {
      if (!get().recentExpanded) set({ recentExpanded: true });
    } else if (age <= OLDER_THRESHOLD_MS) {
      if (!get().olderExpanded) set({ olderExpanded: true });
    }
  },
}));
