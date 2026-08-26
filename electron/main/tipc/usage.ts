// electron/main/tipc/usage.ts
import { tipc } from '@egoist/tipc/main';
import {
  readUsage,
  readUsageSince,
  appendPermissionWait,
  type UsagePeriodStats,
} from '../services/usage/usage-service.js';
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

  getUsageStats: t.procedure
    .input<{ workspaceId: string; sinceMs: number }>()
    .action(async ({ input }) => {
      const conversations = await conversationService.getByWorkspaceId(input.workspaceId);
      const stats = await Promise.all(
        conversations.map((c) => readUsageSince(c.id, input.sinceMs)),
      );
      return { stats: stats.filter((s): s is UsagePeriodStats => s !== null) };
    }),

  recordPermissionWait: t.procedure
    .input<{ conversationId: string; record: PermissionWaitRecord }>()
    .action(async ({ input }) => {
      await appendPermissionWait(input.conversationId, input.record);
    }),
};
