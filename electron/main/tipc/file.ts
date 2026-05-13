// electron/main/tipc/file.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { shell } = electron;

const t = tipc.create();

export const fileRouter = {
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
