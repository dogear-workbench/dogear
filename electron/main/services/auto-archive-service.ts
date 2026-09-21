import { listActiveGroups, archiveGroup } from './group-service.js';
import { getTree } from './conversation-tree-service.js';
import { mainLogger } from '../agents/logger.js';
import { PERSONAL_WORKSPACE_ID } from '../types.js';

const STALE_THRESHOLD_MS = 30 * 86400_000;
const PERSONAL_STALE_THRESHOLD_MS = 7 * 86400_000;
const ARCHIVE_INTERVAL_MS = 24 * 3600_000;

async function collectFolderGroupIds(wsId: string): Promise<Set<string>> {
  const tree = await getTree(wsId);
  const folderGroupIds = new Set<string>();
  for (const folderId of Object.keys(tree.folders)) {
    const children = tree.children[folderId];
    if (!children) continue;
    for (const id of children) folderGroupIds.add(id);
  }
  return folderGroupIds;
}

export async function autoArchiveStaleGroups(
  wsId: string,
  thresholdMs: number = STALE_THRESHOLD_MS,
): Promise<number> {
  const now = Date.now();

  // personal 无手动文件夹树，跳过树读取，全部组按阈值归档
  let folderGroupIds = new Set<string>();
  if (wsId !== PERSONAL_WORKSPACE_ID) {
    try {
      folderGroupIds = await collectFolderGroupIds(wsId);
    } catch (err) {
      mainLogger.warn('[auto-archive] 读取手动文件夹树失败:', err);
    }
  }

  const activeGroups = await listActiveGroups(wsId);
  const stale = activeGroups.filter(
    (g) => now - g.updatedAt > thresholdMs && !folderGroupIds.has(g.id),
  );

  if (stale.length === 0) return 0;

  let count = 0;
  for (const group of stale) {
    try {
      await archiveGroup(wsId, group.id);
      count++;
    } catch (err) {
      mainLogger.warn(`[auto-archive] 归档失败 groupId=${group.id}:`, err);
    }
  }

  mainLogger.info(`[auto-archive] wsId=${wsId.slice(0, 8)} 归档 ${count}/${stale.length} 个过期组`);
  return count;
}

/**
 * 主进程自动归档定时：启动 fire-and-forget 跑一次，之后每 24h 一次。
 * 真实工作区 30 天阈值；personal 隐藏工作区不在 workspaces.json 注册表中，额外单独跑一次（7 天阈值）。
 * 归档走 archiveGroup → 结构操作立即广播，前端列表自动更新。
 */
export function startAutoArchiveTimer(): void {
  const run = async () => {
    try {
      const { getAll } = await import('./workspace-json-service.js');
      for (const ws of await getAll()) {
        await autoArchiveStaleGroups(ws.id);
      }
      await autoArchiveStaleGroups(PERSONAL_WORKSPACE_ID, PERSONAL_STALE_THRESHOLD_MS);
    } catch (err) {
      mainLogger.warn('[auto-archive] 定时执行失败:', err);
    }
  };
  void run();
  setInterval(() => { void run(); }, ARCHIVE_INTERVAL_MS);
}
