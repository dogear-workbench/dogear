// electron/main/tipc/git.ts
import { tipc } from '@egoist/tipc/main';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import { GitServiceError } from '../services/git-service/exec.js';
import * as gitService from '../services/git-service/index.js';
import * as snapshotExclusionScan from '../services/snapshot-exclusion-scan.js';
import type { SnapshotSettings } from '../services/settings-service.js';

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

  // 文件历史面板空态用：该文件按当前配置是否受快照保护（静态判定，不查 git）
  getSnapshotProtection: t.procedure
    .input<{ workspaceId: string; relPath: string }>()
    .action(async ({ input }): Promise<gitService.SnapshotProtection | { error: string }> => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        return await gitService.getSnapshotProtection(workspace.id, workspace.path, input.relPath);
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

  // 设置页快照状态卡用：仅影子仓库侧统计，git 缺失/仓库不存在降级为空统计不报错
  getShadowSnapshotSummary: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }): Promise<gitService.ShadowSnapshotSummary | { error: string }> => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        return await gitService.getShadowSnapshotSummary(workspace.id, workspace.path);
      } catch (error) {
        return errorResult(error);
      }
    }),

  // 设置页「立即瘦身」用：重写全部快照历史释放旧大文件，走串行队列与快照/恢复互斥
  slimShadowRepo: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }): Promise<gitService.SlimShadowResult | { error: string }> => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        return await gitService.slimShadowRepoInQueue(workspace.id, workspace.path);
      } catch (error) {
        return errorResult(error);
      }
    }),

  // 文件树右键菜单着色用：该工作区当前排除路径清单
  getSnapshotExclusions: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }): Promise<{ paths: string[] } | { error: string }> => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        return { paths: await snapshotExclusionScan.getWorkspaceExcludedPaths(workspace.id) };
      } catch (error) {
        return errorResult(error);
      }
    }),

  // 文件树右键排除：主进程读改写 settings 落盘（不走前端 local 链路），返回更新后清单供前端直接刷新
  addSnapshotExcludedPath: t.procedure
    .input<{ workspaceId: string; relPath: string }>()
    .action(async ({ input }): Promise<{ paths: string[] } | { error: string }> => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        const paths = await snapshotExclusionScan.addExcludedPath(workspace.id, input.relPath);
        if (paths === null) return { error: '无效路径：须为相对路径且不含 ..' };
        return { paths };
      } catch (error) {
        return errorResult(error);
      }
    }),

  // 文件树右键恢复：删精确匹配条目，返回更新后清单（删空返回空数组）
  removeSnapshotExcludedPath: t.procedure
    .input<{ workspaceId: string; relPath: string }>()
    .action(async ({ input }): Promise<{ paths: string[] } | { error: string }> => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        const paths = await snapshotExclusionScan.removeExcludedPath(workspace.id, input.relPath);
        if (paths === null) return { error: '无效路径：须为相对路径且不含 ..' };
        return { paths };
      } catch (error) {
        return errorResult(error);
      }
    }),

  // 设置页恢复默认：重置+重扫主进程原子完成（前端 local 防抖写与重扫两步写会互相覆盖，必须单点完成）；返回重置后 snapshot 供前端直接刷新
  restoreSnapshotDefaults: t.procedure
    .action(async (): Promise<{ snapshot: SnapshotSettings } | { error: string }> => {
      try {
        return { snapshot: await snapshotExclusionScan.restoreSnapshotDefaults() };
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
