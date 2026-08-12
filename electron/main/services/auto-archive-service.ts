import { listActiveGroups, archiveGroup } from './group-service.js';
import { getTree } from './conversation-tree-service.js';
import { readIndex, writeIndex, removeGroupEverywhere } from './memory/smart-category-store.js';
import { mainLogger } from '../agents/logger.js';

const STALE_THRESHOLD_MS = 30 * 86400_000;

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

export async function autoArchiveStaleGroups(wsId: string): Promise<number> {
  const now = Date.now();

  let folderGroupIds: Set<string>;
  try {
    folderGroupIds = await collectFolderGroupIds(wsId);
  } catch (err) {
    mainLogger.warn('[auto-archive] 读取手动文件夹树失败:', err);
    folderGroupIds = new Set();
  }

  const activeGroups = await listActiveGroups(wsId);
  const stale = activeGroups.filter(
    (g) => now - g.updatedAt > STALE_THRESHOLD_MS && !folderGroupIds.has(g.id),
  );

  if (stale.length === 0) return 0;

  let count = 0;
  for (const group of stale) {
    try {
      await archiveGroup(wsId, group.id);
      let idx = await readIndex(wsId);
      idx = removeGroupEverywhere(idx, group.id);
      await writeIndex(wsId, idx);
      count++;
    } catch (err) {
      mainLogger.warn(`[auto-archive] 归档失败 groupId=${group.id}:`, err);
    }
  }

  mainLogger.info(`[auto-archive] wsId=${wsId.slice(0, 8)} 归档 ${count}/${stale.length} 个过期组`);
  return count;
}
