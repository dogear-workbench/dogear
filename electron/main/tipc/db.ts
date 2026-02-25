// electron/main/tipc/db.ts
import { tipc } from '@egoist/tipc/main';
import { dbBooks } from '../database/index.js';
import type { Book } from '../database/index.js';

const t = tipc.create();

export const dbRouter = {
  getBooks: t.procedure
    .action(async () => {
      return dbBooks.getAll();
    }),

  getBookById: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return dbBooks.getById(input.id);
    }),

  addBook: t.procedure
    .input<{ book: Book }>()
    .action(async ({ input }) => {
      return dbBooks.add(input.book);
    }),

  updateBook: t.procedure
    .input<{ id: string; data: Partial<Book> }>()
    .action(async ({ input }) => {
      return dbBooks.update(input.id, input.data);
    }),

  deleteBook: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return dbBooks.delete(input.id);
    }),
};
