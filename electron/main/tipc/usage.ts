// electron/main/tipc/usage.ts
import { tipc } from '@egoist/tipc/main';
import { readUsage, appendPermissionWait } from '../services/usage/usage-service.js';
import * as conversationService from '../services/conversation-service.js';
import type { PermissionWaitRecord } from '../types.js';

const t = tipc.create();

export const usageRouter = {
  getUsage: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      conversationService.recomputeUsageSummaryIfStale(input.conversationId).catch(() => {});
      return readUsage(input.conversationId);
    }),

  recordPermissionWait: t.procedure
    .input<{ conversationId: string; record: PermissionWaitRecord }>()
    .action(async ({ input }) => {
      await appendPermissionWait(input.conversationId, input.record);
    }),
};
