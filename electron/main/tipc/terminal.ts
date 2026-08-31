import { tipc } from '@egoist/tipc/main';
import { getTerminalBuffer } from '../services/terminal-stream-service.js';

const t = tipc.create();

export const terminalRouter = {
  getTerminalBuffer: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => getTerminalBuffer(input.conversationId)),
};
