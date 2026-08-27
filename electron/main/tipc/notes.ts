import { tipc } from '@egoist/tipc/main';
import { readNotes, saveNotes } from '../services/memory/notes-store.js';
import {
  createNote,
  getNote,
  listNotes,
  updateNote,
  appendNote,
  removeNote,
  restoreNote,
  purgeNote,
  listTrashNotes,
  searchNotes,
  listNoteTodos,
  type CreateNoteInput,
  type NotePatch,
  type SearchNotesInput,
  type ListTodosInput,
} from '../services/notes/notes-service.js';
import type { TodoStatus } from '../services/notes/note-types.js';

const t = tipc.create();

// 旧版速记板路由（单文件自由笔记）；笔记 Tab 上线后随 ScratchpadSection 在 Step 5 统一移除
export const notesRouter = {
  getNotes: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        return { content: await readNotes(input.workspaceId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  saveNotes: t.procedure
    .input<{ workspaceId: string; content: string }>()
    .action(async ({ input }) => {
      try {
        await saveNotes(input.workspaceId, input.content);
        return { success: true };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  // ─── 卡片笔记 CRUD（.dogear/notes/ 一卡一 md 文件） ───

  createNote: t.procedure
    .input<{ workspacePath: string; input: CreateNoteInput }>()
    .action(async ({ input }) => {
      try {
        return { note: await createNote(input.workspacePath, input.input) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  getNote: t.procedure
    .input<{ workspacePath: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { note: await getNote(input.workspacePath, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  listNotes: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        return { notes: await listNotes(input.workspacePath) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  updateNote: t.procedure
    .input<{ workspacePath: string; noteId: string; patch: NotePatch }>()
    .action(async ({ input }) => {
      try {
        return { note: await updateNote(input.workspacePath, input.noteId, input.patch) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  appendNote: t.procedure
    .input<{ workspacePath: string; noteId: string; text: string }>()
    .action(async ({ input }) => {
      try {
        return { note: await appendNote(input.workspacePath, input.noteId, input.text) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  deleteNote: t.procedure
    .input<{ workspacePath: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { success: await removeNote(input.workspacePath, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  restoreNote: t.procedure
    .input<{ workspacePath: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { success: await restoreNote(input.workspacePath, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  purgeNote: t.procedure
    .input<{ workspacePath: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { success: await purgeNote(input.workspacePath, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  listTrashNotes: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        return { notes: await listTrashNotes(input.workspacePath) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  searchNotes: t.procedure
    .input<{ workspacePath: string; query?: string; tag?: string }>()
    .action(async ({ input }) => {
      try {
        const condition: SearchNotesInput = { query: input.query, tag: input.tag };
        return { notes: await searchNotes(input.workspacePath, condition) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  listTodos: t.procedure
    .input<{ workspacePath: string; status?: TodoStatus; hasPlan?: boolean }>()
    .action(async ({ input }) => {
      try {
        const condition: ListTodosInput = { status: input.status, hasPlan: input.hasPlan };
        return { todos: await listNoteTodos(input.workspacePath, condition) };
      } catch (e) {
        return { error: String(e) };
      }
    }),
};
