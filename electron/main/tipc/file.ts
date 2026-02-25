// electron/main/tipc/file.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { shell } = electron;
import * as bookService from '../services/book-service.js';

const t = tipc.create();

export const fileRouter = {
  selectFile: t.procedure
    .action(async () => {
      return bookService.selectBookFile();
    }),

  importBook: t.procedure
    .input<{ filePath: string; workspaceId?: string }>()
    .action(async ({ input }) => {
      return bookService.importBook(input.filePath, input.workspaceId);
    }),

  // 原 file:openInFolder，改名避免与 book router 冲突
  openFileInFolder: t.procedure
    .input<{ filePath: string }>()
    .action(async ({ input }) => {
      try {
        if (!input.filePath) return { success: false, error: '文件路径为空' };
        await shell.openPath(input.filePath);
        return { success: true };
      } catch (error) {
        console.error('打开文件失败:', error);
        return { success: false, error: String(error) };
      }
    }),
};
