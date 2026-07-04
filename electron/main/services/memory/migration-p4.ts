// Phase 4 幂等迁移：
//   1. 组卡从 <wsData>/digests/<groupId>.md → <wsData>/groups/<groupId>/digest.md
//   2. 删除 <wsData>/digests/_cleaned/ 目录（不再留盘干净逐字稿）
//   3. 迁移完成后若 digests/ 只剩 _archive/ 或全空，保留 _archive；空目录不动
import fs from 'node:fs/promises';
import path from 'node:path';
import * as workspaceService from '../workspace-json-service.js';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { mainLogger } from '../../agents/logger.js';
import { parseFrontmatter } from './memory-fs.js';
import { getGroupDigestPath, getGroupDir } from './group-digest-store.js';

function getLegacyDigestsDir(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'digests');
}

/** 主入口，幂等执行 */
export async function runMigrationP4(_configDir: string): Promise<void> {
  mainLogger.info('[migration-p4] 开始迁移');
  const workspaces = await workspaceService.getAll();
  for (const ws of workspaces) {
    try {
      await migrateWorkspace(ws.id);
    } catch (err) {
      mainLogger.warn(`[migration-p4] 工作区 ${ws.id} 迁移失败:`, err);
    }
  }
  mainLogger.info('[migration-p4] 迁移完成');
}

async function migrateWorkspace(wsId: string): Promise<void> {
  const legacyDir = getLegacyDigestsDir(wsId);

  // 1. 迁移组卡
  await migrateGroupDigests(wsId, legacyDir);

  // 2. 删掉 _cleaned/
  await removeCleanedDir(legacyDir);
}

async function migrateGroupDigests(wsId: string, legacyDir: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(legacyDir);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }

  for (const name of names) {
    if (name.startsWith('_')) continue; // 跳过 _archive / _cleaned / _orphan
    if (!name.endsWith('.md')) continue;

    const oldPath = path.join(legacyDir, name);

    // 只迁移「新格式组卡」（frontmatter 有 groupId），旧会话卡（只有 sessionId）由 migration-p3 处理过
    let groupId: string;
    try {
      const raw = await fs.readFile(oldPath, 'utf-8');
      const { fm } = parseFrontmatter(raw);
      const gid = typeof fm.groupId === 'string' ? fm.groupId.trim() : '';
      if (!gid) {
        mainLogger.warn(`[migration-p4] 缺 groupId 的 md 跳过: ${oldPath}`);
        continue;
      }
      groupId = gid;
    } catch (err) {
      mainLogger.warn(`[migration-p4] 读取失败跳过: ${oldPath}`, err);
      continue;
    }

    const newPath = getGroupDigestPath(wsId, groupId);

    // 幂等：新路径已存在则删旧路径（保新弃旧，新是权威）
    try {
      await fs.access(newPath);
      // 新已存在
      try {
        await fs.unlink(oldPath);
        mainLogger.info(`[migration-p4] 新路径已存在，删除旧: ${oldPath}`);
      } catch { /* 忽略 */ }
      continue;
    } catch {
      // 新路径不存在，走真迁移
    }

    try {
      await fs.mkdir(getGroupDir(wsId, groupId), { recursive: true });
      // 用 read+write+unlink，避免跨文件系统 rename 失败
      const raw = await fs.readFile(oldPath, 'utf-8');
      await fs.writeFile(newPath, raw, 'utf-8');
      await fs.unlink(oldPath);
      mainLogger.info(`[migration-p4] 迁移: ${name} → groups/${groupId}/digest.md`);
    } catch (err) {
      mainLogger.warn(`[migration-p4] 迁移失败 ${oldPath}:`, err);
      // 单个失败不影响其他
    }
  }
}

async function removeCleanedDir(legacyDir: string): Promise<void> {
  const cleanedDir = path.join(legacyDir, '_cleaned');
  try {
    await fs.rm(cleanedDir, { recursive: true, force: true });
    mainLogger.info(`[migration-p4] 删除 _cleaned/: ${cleanedDir}`);
  } catch (err) {
    mainLogger.warn(`[migration-p4] 删除 _cleaned/ 失败: ${cleanedDir}`, err);
  }
}
