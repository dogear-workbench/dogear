/**
 * notes/memory 存量迁移：<workspace>/.dogear/{notes,memory} → config workspaces/{id}/{notes,memory}
 *
 * - 幂等：标记文件 notes-memory-migrated.json（status migrating|done），done 直接跳过
 * - 目标不存在时整目录 rename（同卷原子）；否则条目级合并 move，EXDEV 跨卷退化为 copy+unlink
 * - 目标同名条目已存在时保留目标侧（Step 1 切路径后新路径可能有新写入），源侧改名 .migrated-conflict-<ts> 并入，不丢数据
 * - 半途崩溃后源留剩余条目、目标留已迁条目，下次启动按合并 move 续迁；源清理不净则保持 migrating 待重试
 * - 迁完删旧目录并重建两侧 index.json（并入场景旧索引缺条目，重建最稳）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as workspaceJsonService from './workspace-json-service.js';
import { getConfigDir } from './settings-service.js';
import { getNotesDir, rebuildIndex as rebuildNotesIndex } from './notes/notes-store.js';
import { getMemoryDir } from './memory/memory-fs.js';
import { rebuildIndex as rebuildMemoryIndex } from './memory/memory-indexer.js';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';
import { mainLogger } from '../agents/logger.js';

const log = mainLogger.child('migrate-notes-memory');

const MARKER_FILE = 'notes-memory-migrated.json';

interface MigrationCounts {
  notesFiles: number;
  memoryFiles: number;
  conflicts: number;
}

interface MigrationMarker {
  status: 'migrating' | 'done';
  startedAt?: string;
  migratedAt?: string;
  counts?: MigrationCounts;
}

interface MoveStats {
  files: number;
  conflicts: number;
  dirtySource: boolean;
}

function getMarkerPath(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, MARKER_FILE);
}

function emptyCounts(): MigrationCounts {
  return { notesFiles: 0, memoryFiles: 0, conflicts: 0 };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) count += await countFiles(path.join(dir, entry.name));
    else if (entry.isFile()) count++;
  }
  return count;
}

function conflictDestPath(destPath: string, suffix: string): string {
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  return path.join(path.dirname(destPath), `${base}${suffix}${ext}`);
}

async function moveFile(srcFile: string, destFile: string): Promise<void> {
  try {
    await fs.rename(srcFile, destFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.copyFile(srcFile, destFile);
      await fs.unlink(srcFile).catch(() => {});
    } else {
      throw err;
    }
  }
}

async function mergeMoveRecursive(src: string, dest: string, conflictSuffix: string): Promise<MoveStats> {
  const stats: MoveStats = { files: 0, conflicts: 0, dirtySource: false };
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const sub = await mergeMoveRecursive(srcPath, destPath, conflictSuffix);
      stats.files += sub.files;
      stats.conflicts += sub.conflicts;
      if (sub.dirtySource) {
        stats.dirtySource = true;
      } else {
        await fs.rmdir(srcPath).catch(() => { stats.dirtySource = true; });
      }
    } else if (entry.isFile()) {
      if (await pathExists(destPath)) {
        try {
          await fs.rename(srcPath, conflictDestPath(destPath, conflictSuffix));
          stats.conflicts++;
        } catch {
          stats.dirtySource = true;
        }
      } else {
        try {
          await moveFile(srcPath, destPath);
          stats.files++;
        } catch {
          stats.dirtySource = true;
        }
      }
    }
  }
  return stats;
}

async function mergeMoveDir(src: string, dest: string, conflictSuffix: string): Promise<MoveStats> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (!(await pathExists(dest))) {
    try {
      await fs.rename(src, dest);
      return { files: await countFiles(dest), conflicts: 0, dirtySource: false };
    } catch {
      // 同卷 rename 失败（跨卷/占用）→ 逐条合并
    }
  }
  const stats = await mergeMoveRecursive(src, dest, conflictSuffix);
  if (!stats.dirtySource) {
    await fs.rmdir(src).catch(() => { stats.dirtySource = true; });
  }
  return stats;
}

async function migrateWorkspace(workspaceId: string, workspacePath: string): Promise<void> {
  const markerPath = getMarkerPath(workspaceId);
  const marker = await safeJsonRead<MigrationMarker | null>(markerPath, null);
  if (marker?.status === 'done') return;

  const legacyNotes = path.join(workspacePath, '.dogear', 'notes');
  const legacyMemory = path.join(workspacePath, '.dogear', 'memory');
  const notesExists = await pathExists(legacyNotes);
  const memoryExists = await pathExists(legacyMemory);
  if (!notesExists && !memoryExists) {
    await safeJsonWrite(markerPath, { status: 'done', migratedAt: new Date().toISOString(), counts: emptyCounts() });
    return;
  }

  await safeJsonWrite(markerPath, { status: 'migrating', startedAt: new Date().toISOString() });

  const counts = emptyCounts();
  const conflictSuffix = `.migrated-conflict-${Date.now()}`;

  if (notesExists) {
    const stats = await mergeMoveDir(legacyNotes, getNotesDir(workspaceId), conflictSuffix);
    counts.notesFiles = stats.files;
    counts.conflicts += stats.conflicts;
    if (stats.dirtySource) {
      log.warn(`工作区 ${workspaceId} notes 旧目录清理未净，保持 migrating 待下次启动续迁`);
      return;
    }
  }
  if (memoryExists) {
    const stats = await mergeMoveDir(legacyMemory, getMemoryDir(workspaceId), conflictSuffix);
    counts.memoryFiles = stats.files;
    counts.conflicts += stats.conflicts;
    if (stats.dirtySource) {
      log.warn(`工作区 ${workspaceId} memory 旧目录清理未净，保持 migrating 待下次启动续迁`);
      return;
    }
  }

  try {
    await rebuildNotesIndex(workspaceId);
    await rebuildMemoryIndex(workspaceId);
  } catch (err) {
    log.warn(`工作区 ${workspaceId} 索引重建失败，保持 migrating 待下次启动续迁`, err);
    return;
  }

  await safeJsonWrite(markerPath, { status: 'done', migratedAt: new Date().toISOString(), counts });
  log.info(`工作区 ${workspaceId} notes/memory 迁移完成：notes ${counts.notesFiles} 个文件，memory ${counts.memoryFiles} 个文件，冲突并入 ${counts.conflicts} 个`);
}

/** 应用启动入口：遍历全部工作区执行迁移，单工作区失败不影响其他 */
export async function migrateNotesMemoryAllWorkspaces(): Promise<void> {
  const workspaces = await workspaceJsonService.getAll();
  for (const ws of workspaces) {
    try {
      await migrateWorkspace(ws.id, ws.path);
    } catch (err) {
      log.error(`工作区 ${ws.id} notes/memory 迁移失败，下次启动重试`, err);
    }
  }
}
