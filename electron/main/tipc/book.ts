// electron/main/tipc/book.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { shell } = electron;
import { dbBooks } from '../database/index.js';
import * as bookService from '../services/book-service.js';
import * as workspaceService from '../services/workspace-service.js';
import path from 'path';

const t = tipc.create();

export const bookRouter = {
  getChapterMetadata: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      return bookService.getChapterMetadata(input.bookId);
    }),

  getChapter: t.procedure
    .input<{ chapterId: string }>()
    .action(async ({ input }) => {
      return bookService.getChapter(input.chapterId);
    }),

  saveProgress: t.procedure
    .input<{ bookId: string; chapterId: string }>()
    .action(async ({ input }) => {
      return bookService.saveReadingProgress(input.bookId, input.chapterId);
    }),

  getBookByFilePath: t.procedure
    .input<{ filePathOrBookId: string }>()
    .action(async ({ input }) => {
      const books = dbBooks.getAll();
      // 首先尝试作为 bookId 查找
      const byId = books.find(book => book.id === input.filePathOrBookId);
      if (byId) return byId;
      // 然后尝试通过文件路径匹配
      const byPath = books.find(book =>
        book.file_path === input.filePathOrBookId ||
        book.original_file_path === input.filePathOrBookId
      );
      if (byPath) return byPath;
      // 最后尝试通过书名匹配（去除扩展名）
      const baseName = path.basename(input.filePathOrBookId, path.extname(input.filePathOrBookId));
      return books.find(book => book.title === baseName) ?? undefined;
    }),

  getWorkspaceFilePath: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      try {
        const book = dbBooks.getById(input.bookId);
        if (!book) return { path: null, error: '书籍不存在' };
        const workspace = await workspaceService.getCurrentWorkspace();
        if (!workspace) return { path: null, error: '未设置默认工作区' };
        const workspaceFilePath = await workspaceService.getBookFilePath(workspace, input.bookId, book.file_path);
        return { path: workspaceFilePath };
      } catch (error) {
        return { path: null, error: String(error) };
      }
    }),

  // 原 book:openInFolder，改名避免与 file router 冲突
  openBookInFolder: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceService.getCurrentWorkspace();
        if (!workspace) return { success: false, error: '未设置默认工作区' };
        const workspaceFilePath = await workspaceService.getBookFilePath(workspace, input.bookId);
        await shell.openPath(workspaceFilePath);
        return { success: true };
      } catch (error) {
        console.error('打开文件失败:', error);
        return { success: false, error: String(error) };
      }
    }),

  jumpToPosition: t.procedure
    .input<{ chapterId: string; position?: { start: number; end: number } }>()
    .action(async ({ input }) => {
      // 由渲染层处理跳转，主进程仅做转发
      return { chapterId: input.chapterId, position: input.position };
    }),
};