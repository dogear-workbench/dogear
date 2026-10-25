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
    .input<{ workspaceId?: string; sinceMs: number }>()
    .action(async ({ input }) => {
      const collect = async (workspaceId: string): Promise<Array<UsagePeriodStats & { workspaceId: string }>> => {
        const conversations = await conversationService.getByWorkspaceId(workspaceId);
        const stats = await Promise.all(
          conversations.map((c) => readUsageSince(c.id, input.sinceMs)),
        );
        return stats
          .filter((s): s is UsagePeriodStats => s !== null)
          .map((s) => ({ ...s, workspaceId }));
      };
      if (input.workspaceId) {
        return { stats: await collect(input.workspaceId) };
      }
      const { getAll } = await import('../services/workspace-json-service.js');
      const workspaces = await getAll();
      const stats = (await Promise.all(workspaces.map((ws) => collect(ws.id)))).flat();
      return { stats };
    }),

  recordPermissionWait: t.procedure
    .input<{ conversationId: string; record: PermissionWaitRecord }>()
    .action(async ({ input }) => {
      await appendPermissionWait(input.conversationId, input.record);
    }),
};
