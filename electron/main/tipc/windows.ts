// electron/main/tipc/windows.ts
import { tipc } from '@egoist/tipc/main';

const t = tipc.create();

export const windowsRouter = {
  /** 打开数据中心窗口（单例，已存在则聚焦） */
  openDataCenterWindow: t.procedure
    .action(async () => {
      const { createDataCenterWindow } = await import('../index.js');
      createDataCenterWindow();
      return { success: true };
    }),
};
