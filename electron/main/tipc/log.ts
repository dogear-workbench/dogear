// electron/main/tipc/log.ts
// 渲染进程日志转发：将渲染层的 warn/error 日志写入主进程日志文件
import { tipc } from '@egoist/tipc/main';
import { mainLogger } from '../agents/logger.js';

const t = tipc.create();

export const logRouter = {
  /**
   * 接收渲染进程的日志，通过主进程 Logger 写入文件
   * 仅接受 warn 和 error 级别
   */
  logFromRenderer: t.procedure
    .input<{ level: 'warn' | 'error'; message: string; stack?: string }>()
    .action(async ({ input }) => {
      const { level, message, stack } = input;
      const fullMessage = stack ? `${message}\n${stack}` : message;

      if (level === 'error') {
        mainLogger.error('[Renderer]', fullMessage);
      } else {
        mainLogger.warn('[Renderer]', fullMessage);
      }

      return { success: true };
    }),
};
