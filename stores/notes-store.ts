import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { Note, NoteMeta } from '@/types/note';

export type NotePatch = Partial<Pick<Note, 'content' | 'tags' | 'links'>>;

interface NotesState {
  notes: NoteMeta[];
  loading: boolean;
  /** 当前已加载的工作区路径，用于惰性加载去重与 notesChanged 事件匹配 */
  loadedWorkspacePath: string | null;
  /** 当前打开详情的卡片 id，null = 停留在时间流列表 */
  activeNoteId: string | null;

  loadNotes: (workspacePath: string) => Promise<void>;
  /** 监听主进程 notesChanged 广播，工作区匹配时重新拉取列表；返回取消订阅函数 */
  subscribeNotesChanged: () => () => void;
  setActiveNoteId: (noteId: string | null) => void;
  /** 新建卡片（默认空白卡）并本地插入列表，刷新由 notesChanged 兜底；是否进入编辑态由调用方决定 */
  createNote: (workspacePath: string, input?: { content?: string; tags?: string[] }) => Promise<Note | null>;
  /** 保存局部 patch（tags/links 整体深替换）；成功后本地同步列表条目 */
  updateNote: (workspacePath: string, noteId: string, patch: NotePatch) => Promise<Note | null>;
  /** 软删除移入回收站；成功后本地移除，时间流最终一致靠 notesChanged 广播兜底 */
  deleteNote: (workspacePath: string, noteId: string) => Promise<boolean>;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  loading: false,
  loadedWorkspacePath: null,
  activeNoteId: null,

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

  setActiveNoteId: (noteId) => set({ activeNoteId: noteId }),

  createNote: async (workspacePath, input) => {
    try {
      const result = await client.createNote({ workspacePath, input: { content: '', ...input } });
      if ('note' in result && result.note) {
        const note = result.note;
        set({ notes: [note, ...get().notes] });
        return note;
      }
      if ('error' in result) console.error('[notes] createNote 失败:', result.error);
      return null;
    } catch (error) {
      console.error('[notes] createNote 失败:', error);
      return null;
    }
  },

  updateNote: async (workspacePath, noteId, patch) => {
    try {
      const result = await client.updateNote({ workspacePath, noteId, patch });
      if ('note' in result && result.note) {
        const updated = result.note;
        set({ notes: get().notes.map((n) => (n.id === noteId ? updated : n)) });
        return updated;
      }
      if ('error' in result) console.error('[notes] updateNote 失败:', result.error);
      return null;
    } catch (error) {
      console.error('[notes] updateNote 失败:', error);
      return null;
    }
  },

  deleteNote: async (workspacePath, noteId) => {
    try {
      const result = await client.deleteNote({ workspacePath, noteId });
      if ('success' in result && result.success) {
        set({ notes: get().notes.filter((n) => n.id !== noteId) });
        return true;
      }
      if ('error' in result) console.error('[notes] deleteNote 失败:', result.error);
      return false;
    } catch (error) {
      console.error('[notes] deleteNote 失败:', error);
      return false;
    }
  },
}));
