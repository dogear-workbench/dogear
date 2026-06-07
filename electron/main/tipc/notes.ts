import { tipc } from '@egoist/tipc/main';
import { readNotes, saveNotes } from '../services/memory/notes-store.js';

const t = tipc.create();

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
};
