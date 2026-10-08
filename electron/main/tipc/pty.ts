import { tipc } from '@egoist/tipc/main';
import type { PtyTerminalInfo } from '../services/pty-service.js';
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  killTerminal,
  getBuffer,
  listTerminals,
  setPtyEventBroadcaster,
} from '../services/pty-service.js';
import { broadcastToWindows } from '../services/renderer-broadcast.js';

const t = tipc.create();

export interface PtyBufferSnapshot {
  buffer: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode?: number;
}

/** 把服务层 PtyEvent 路由到三个渲染层广播事件；由 registerTipcHandlers 调用 */
export function registerPtyBroadcaster(): void {
  setPtyEventBroadcaster((event) => {
    if (event.type === 'created') {
      broadcastToWindows((h) =>
        h.ptyCreated.send({
          terminalId: event.terminalId,
          conversationId: event.conversationId,
          command: event.command,
        }),
      );
    } else if (event.type === 'data') {
      broadcastToWindows((h) => h.ptyData.send({ terminalId: event.terminalId, data: event.data }));
    } else {
      broadcastToWindows((h) => h.ptyExit.send({ terminalId: event.terminalId, exitCode: event.exitCode }));
    }
  });
}

export const ptyRouter = {
  ptyCreate: t.procedure
    .input<{
      conversationId: string | null;
      command?: string;
      cwd: string;
      shell?: string;
      workspaceRoots?: string[];
      cols?: number;
      rows?: number;
    }>()
    .action(async ({ input }) => createTerminal(input)),

  ptyWrite: t.procedure
    .input<{ terminalId: string; data: string }>()
    .action(async ({ input }) => writeTerminal(input.terminalId, input.data)),

  ptyResize: t.procedure
    .input<{ terminalId: string; cols: number; rows: number }>()
    .action(async ({ input }) => resizeTerminal(input.terminalId, input.cols, input.rows)),

  ptyKill: t.procedure
    .input<{ terminalId: string }>()
    .action(async ({ input }) => killTerminal(input.terminalId)),

  getPtyBuffer: t.procedure
    .input<{ terminalId: string }>()
    .action(async ({ input }): Promise<PtyBufferSnapshot | null> => {
      const info: PtyTerminalInfo | undefined = listTerminals().find(
        (i) => i.terminalId === input.terminalId,
      );
      const buffer = getBuffer(input.terminalId);
      if (!info || buffer === null) return null;
      return { buffer, cols: info.cols, rows: info.rows, exited: info.exited, exitCode: info.exitCode };
    }),

  listPtyTerminals: t.procedure
    .input<{ conversationId?: string }>()
    .action(async ({ input }) => listTerminals(input?.conversationId)),
};
