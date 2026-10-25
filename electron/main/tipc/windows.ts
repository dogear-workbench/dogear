// electron/main/tipc/windows.ts
import { tipc } from '@egoist/tipc/main';

const t = tipc.create();

export const windowsRouter = {
  /** 打开数据中心窗口（单例，已存在则聚焦） */
  openDataCenterWindow: t.procedure
    .action(async () => {
      const { createDataCenterWindow } = await import('../main-app.js');
      await createDataCenterWindow();
      return { success: true };
    }),

  /** 打开工作台窗口（单例，已存在则聚焦） */
  openWorkbenchWindow: t.procedure
    .action(async () => {
      const { createWorkbenchWindow } = await import('../main-app.js');
      await createWorkbenchWindow();
      return { success: true };
    }),

  /** 打开笔记窗口（单例，已存在则聚焦） */
  openNotesWindow: t.procedure
    .action(async () => {
      const { createNotesWindow } = await import('../main-app.js');
      await createNotesWindow();
      return { success: true };
    }),

  /** 工作台窗口是否存活（会话窗口冷启动互斥态同步用） */
  getWorkbenchWindowOpen: t.procedure
    .action(async () => {
      const { getWorkbenchWindowOpen } = await import('../main-app.js');
      return { open: getWorkbenchWindowOpen() };
    }),
};
