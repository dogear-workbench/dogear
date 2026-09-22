// electron/main/tipc/git.ts
import { tipc } from '@egoist/tipc/main';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import { GitServiceError } from '../services/git-service/exec.js';
import * as gitService from '../services/git-service/index.js';

const t = tipc.create();

function errorResult(error: unknown): { error: string } {
  if (error instanceof GitServiceError) return { error: error.message };
  console.error('git 操作失败:', error);
  return { error: error instanceof Error ? error.message : String(error) };
}

export const gitRouter = {
  getGitCapability: t.procedure.action(async () => ({ available: await gitService.hasGit() })),

  getFileHistory: t.procedure
    .input<{ workspaceId: string; relPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        const history = await gitService.getFileHistory(workspace.id, workspace.path, input.relPath);
        return { history };
      } catch (error) {
        return errorResult(error);
      }
    }),

  restoreSnapshot: t.procedure
    .input<{ workspaceId: string; ref: string; relPath?: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        await gitService.restoreFromSnapshot(workspace.id, workspace.path, input.ref, input.relPath);
        return { success: true };
      } catch (error) {
        return errorResult(error);
      }
    }),

  getHistoryFileContent: t.procedure
    .input<{ workspaceId: string; source: 'shadow' | 'repo'; ref: string; relPath: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        const content =
          input.source === 'shadow'
            ? await gitService.getShadowFileContent(workspace.id, workspace.path, input.ref, input.relPath)
            : await gitService.getUserRepoFileContent(workspace.path, input.ref, input.relPath);
        return { content };
      } catch (error) {
        return errorResult(error);
      }
    }),
};
