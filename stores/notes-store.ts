import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { NoteMeta } from '@/types/note';

interface NotesState {
  notes: NoteMeta[];
  loading: boolean;
  /** 当前已加载的工作区路径，用于惰性加载去重与 notesChanged 事件匹配 */
  loadedWorkspacePath: string | null;

  loadNotes: (workspacePath: string) => Promise<void>;
  /** 监听主进程 notesChanged 广播，工作区匹配时重新拉取列表；返回取消订阅函数 */
  subscribeNotesChanged: () => () => void;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  loading: false,
  loadedWorkspacePath: null,

  loadNotes: async (workspacePath) => {
    set({ loading: true });
    try {
      const result = await client.listNotes({ workspacePath });
      if ('notes' in result) {
        const notes = [...(result.notes ?? [])].sort((a, b) => b.created.localeCompare(a.created));
        set({ notes, loadedWorkspacePath: workspacePath });
      }
    } catch (error) {
      console.error('[notes] listNotes 失败:', error);
    } finally {
      set({ loading: false });
    }
  },

  subscribeNotesChanged: () => {
    const unsub = rendererEvents.notesChanged.listen((data) => {
      const { loadedWorkspacePath, loadNotes } = get();
      if (loadedWorkspacePath && data.workspacePath === loadedWorkspacePath) {
        void loadNotes(loadedWorkspacePath);
      }
    });
    return () => unsub();
  },
}));
