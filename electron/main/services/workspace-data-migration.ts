/**
 * 工作区数据归位迁移：tasks.json / articles/ 从工作区磁盘根 `.dogear/` 搬入 configDir/workspaces/{wsid}/
 *
 * 幂等策略（绝不丢数据）：
 * - 旧不存在 → 跳过；新不存在 → rename（跨盘 EXDEV 时 copy + rm）
 * - 新已存在 → 保留新，旧位置改名 `.migrated-{yyyyMMdd}` 留档
 * - 迁移后旧 `.dogear/` 为空才删除，非空保留（可能存无关文件）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readRegisteredWorkspaces } from './data-registry.js';
import { getWorkspaceDataDir } from './workspace-data-root.js';

function migratedStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${mm}${dd}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function movePath(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

async function migrateOne(oldPath: string, newPath: string): Promise<void> {
  if (!(await pathExists(oldPath))) return;
  if (await pathExists(newPath)) {
    await fs.rename(oldPath, `${oldPath}.migrated-${migratedStamp()}`);
    return;
  }
  await movePath(oldPath, newPath);
}

async function removeDirIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length > 0) return;
    await fs.rmdir(dir);
  } catch {
    // 目录不存在或删除失败（仍有文件占用）均不影响启动
  }
}

export async function migrateWorkspaceDataIfNeeded(): Promise<void> {
  const registered = await readRegisteredWorkspaces();
  for (const ws of registered) {
    const legacyRoot = path.join(ws.path, '.dogear');
    const targetRoot = getWorkspaceDataDir(ws.id);
    try {
      await migrateOne(path.join(legacyRoot, 'tasks.json'), path.join(targetRoot, 'tasks.json'));
      await migrateOne(path.join(legacyRoot, 'articles'), path.join(targetRoot, 'articles'));
      await removeDirIfEmpty(legacyRoot);
    } catch (err) {
      console.error(`[workspace-data-migration] 工作区 ${ws.id} 数据迁移失败:`, err);
    }
  }
}
