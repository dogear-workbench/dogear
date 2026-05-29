// electron/main/tipc/usage.ts
import { tipc } from '@egoist/tipc/main';
import { readUsage } from '../services/usage/usage-service.js';

const t = tipc.create();

export const usageRouter = {
  getUsage: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => readUsage(input.conversationId)),
};
