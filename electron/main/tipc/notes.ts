import { tipc } from '@egoist/tipc/main';
import {
  createNote,
  getNote,
  getTrashedNote,
  listNotes,
  updateNote,
  appendNote,
  removeNote,
  restoreNote,
  purgeNote,
  listTrashNotes,
  searchNotes,
  type CreateNoteInput,
  type NotePatch,
  type SearchNotesInput,
} from '../services/notes/notes-service.js';

const t = tipc.create();

// ─── 卡片笔记 CRUD（config/workspaces/{id}/notes/ 一卡一 md 文件） ───

export const notesRouter = {
  createNote: t.procedure
    .input<{ workspaceId: string; input: CreateNoteInput }>()
    .action(async ({ input }) => {
      try {
        return { note: await createNote(input.workspaceId, input.input) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  getNote: t.procedure
    .input<{ workspaceId: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { note: await getNote(input.workspaceId, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  listNotes: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        return { notes: await listNotes(input.workspaceId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  updateNote: t.procedure
    .input<{ workspaceId: string; noteId: string; patch: NotePatch }>()
    .action(async ({ input }) => {
      try {
        return { note: await updateNote(input.workspaceId, input.noteId, input.patch) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  appendNote: t.procedure
    .input<{ workspaceId: string; noteId: string; text: string }>()
    .action(async ({ input }) => {
      try {
        return { note: await appendNote(input.workspaceId, input.noteId, input.text) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  deleteNote: t.procedure
    .input<{ workspaceId: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { success: await removeNote(input.workspaceId, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  restoreNote: t.procedure
    .input<{ workspaceId: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { success: await restoreNote(input.workspaceId, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  purgeNote: t.procedure
    .input<{ workspaceId: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { success: await purgeNote(input.workspaceId, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  listTrashNotes: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        return { notes: await listTrashNotes(input.workspaceId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  getTrashNote: t.procedure
    .input<{ workspaceId: string; noteId: string }>()
    .action(async ({ input }) => {
      try {
        return { note: await getTrashedNote(input.workspaceId, input.noteId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  searchNotes: t.procedure
    .input<{ workspaceId: string; query?: string; tag?: string }>()
    .action(async ({ input }) => {
      try {
        const condition: SearchNotesInput = { query: input.query, tag: input.tag };
        return { notes: await searchNotes(input.workspaceId, condition) };
      } catch (e) {
        return { error: String(e) };
      }
    }),
};
