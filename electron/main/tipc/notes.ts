import { tipc } from '@egoist/tipc/main';
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
  type CreateNoteInput,
  type NotePatch,
  type SearchNotesInput,
} from '../services/notes/notes-service.js';

const t = tipc.create();

// ─── 卡片笔记 CRUD（.dogear/notes/ 一卡一 md 文件） ───

export const notesRouter = {
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
};
