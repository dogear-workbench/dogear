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

export interface WorkspaceGitSummary {
  userRepo: { isRepo: boolean; branch: string | null; changedCount: number };
  shadow: { snapshotCount: number; lastTime: string | null; sizeBytes: number };
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

  // 数据中心汇总用：用户 Git 仓库 + 自动快照状态；git 缺失/非仓库/查询失败均降级不报错
  getWorkspaceGitSummary: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }): Promise<WorkspaceGitSummary | { error: string }> => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        const summary: WorkspaceGitSummary = {
          userRepo: { isRepo: false, branch: null, changedCount: 0 },
          shadow: { snapshotCount: 0, lastTime: null, sizeBytes: 0 },
        };
        if (!(await gitService.hasGit())) return summary;
        try {
          const status = await gitService.getUserRepoStatus(workspace.path);
          summary.userRepo = { isRepo: true, branch: status.branch || null, changedCount: status.entries.length };
        } catch {
          // 非 git 仓库等状态查询失败保持 isRepo: false 降级
        }
        try {
          const [entries, sizeBytes] = await Promise.all([
            gitService.listShadowHistory(workspace.id, workspace.path),
            gitService.getShadowRepoSizeBytes(workspace.id),
          ]);
          summary.shadow = { snapshotCount: entries.length, lastTime: entries[0]?.time ?? null, sizeBytes };
        } catch {
          // 影子仓库查询失败保持空统计降级
        }
        return summary;
      } catch (error) {
        return errorResult(error);
      }
    }),
};
