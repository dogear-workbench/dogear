// electron/main/tipc/db.ts
import { tipc } from '@egoist/tipc/main';
import * as bookService from '../services/book-service.js';
import type { Book } from '../services/book-service.js';

const t = tipc.create();

export const dbRouter = {
  getBooks: t.procedure
    .action(async () => {
      return bookService.getAllBooks();
    }),

  getBookById: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return bookService.getBookById(input.id);
    }),

  addBook: t.procedure
    .input<{ book: Book }>()
    .action(async ({ input }) => {
      return bookService.importBook(input.book.original_file_path!, input.book.workspace_id);
    }),

  updateBook: t.procedure
    .input<{ id: string; data: Partial<Book> }>()
    .action(async ({ input }) => {
      return bookService.updateBookMeta(input.id, input.data);
    }),

  deleteBook: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return bookService.deleteBook(input.id);
    }),
};
