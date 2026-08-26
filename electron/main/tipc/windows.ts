// electron/main/tipc/windows.ts
import { tipc } from '@egoist/tipc/main';

const t = tipc.create();

export const windowsRouter = {
  /** 打开设置窗口（单例，已存在则聚焦） */
  openSettingsWindow: t.procedure
    .action(async () => {
      const { createSettingsWindow } = await import('../index.js');
      createSettingsWindow();
      return { success: true };
    }),

  /** 请求关闭设置窗口（触发渲染进程 dirty 拦截流程） */
  requestCloseSettingsWindow: t.procedure
    .action(async () => {
      const { requestCloseSettingsWindow } = await import('../index.js');
      requestCloseSettingsWindow();
      return { success: true };
    }),

  /** 强制关闭设置窗口（跳过 dirty 拦截） */
  forceCloseSettingsWindow: t.procedure
    .action(async () => {
      const { forceCloseSettingsWindow } = await import('../index.js');
      forceCloseSettingsWindow();
      return { success: true };
    }),
};
