import { create } from 'zustand';
import { client } from '@/lib/client';

export interface HistoryTarget {
  name: string;
  path: string;
  isFolder: boolean;
}

interface GitHistoryState {
  open: boolean;
  target: HistoryTarget | null;
  /** null = 未检测；hasGit 结果（主进程有缓存，幂等轻量） */
  gitAvailable: boolean | null;
  checkGitAvailable: () => Promise<void>;
  openHistory: (target: HistoryTarget) => void;
  closeHistory: () => void;
}

export const useGitHistoryStore = create<GitHistoryState>((set, get) => ({
  open: false,
  target: null,
  gitAvailable: null,
  checkGitAvailable: async () => {
    if (get().gitAvailable !== null) return;
    try {
      const res = await client.getGitCapability();
      set({ gitAvailable: res.available });
    } catch (error) {
      console.error('检测 git 能力失败:', error);
      set({ gitAvailable: false });
    }
  },
  openHistory: (target) => set({ open: true, target }),
  closeHistory: () => set({ open: false }),
}));
