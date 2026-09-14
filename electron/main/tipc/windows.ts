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

  /** 打开伴随工作台窗口（单例，已存在则聚焦） */
  openWorkbenchWindow: t.procedure
    .action(async () => {
      const { createWorkbenchWindow } = await import('../main-app.js');
      await createWorkbenchWindow();
      return { success: true };
    }),

  /** 关闭伴随工作台窗口（互斥切换钮：已开启时点击收回） */
  closeWorkbenchWindow: t.procedure
    .action(async () => {
      const { closeWorkbenchWindow } = await import('../main-app.js');
      closeWorkbenchWindow();
      return { success: true };
    }),

  /** 打开笔记窗口（单例，已存在则聚焦） */
  openNotesWindow: t.procedure
    .action(async () => {
      const { createNotesWindow } = await import('../main-app.js');
      await createNotesWindow();
      return { success: true };
    }),

  /** 笔记窗口是否存活（通知点击 focusTask 分流用） */
  getNotesWindowOpen: t.procedure
    .action(async () => {
      const { getNotesWindow } = await import('../main-app.js');
      return { open: getNotesWindow() !== null };
    }),

  /** 工作台窗口是否存活（会话窗口冷启动互斥态同步用） */
  getWorkbenchWindowOpen: t.procedure
    .action(async () => {
      const { getWorkbenchWindowOpen } = await import('../main-app.js');
      return { open: getWorkbenchWindowOpen() };
    }),
};
