import { tipc } from '@egoist/tipc/main';
import {
  getWorkspaceConfig,
  updateWorkspaceConfig,
  type WorkspaceConfig,
} from '../services/workspace-config-service.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';

const t = tipc.create();

export const workspaceConfigRouter = {
  getWorkspaceConfig: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const config = await getWorkspaceConfig(input.workspaceId);
        return { config };
      } catch (error) {
        console.error('读取工作区配置失败:', error);
        return { error: String(error) };
      }
    }),

  updateWorkspaceConfig: t.procedure
    .input<{ workspaceId: string; config: Partial<WorkspaceConfig> }>()
    .action(async ({ input }) => {
      try {
        const config = await updateWorkspaceConfig(input.workspaceId, input.config);
        if (input.config.abilityOverrides) {
          getPiSessionManager().markWorkspaceSessionsDirty(input.workspaceId);
        }
        return { config };
      } catch (error) {
        console.error('更新工作区配置失败:', error);
        return { error: String(error) };
      }
    }),
};
