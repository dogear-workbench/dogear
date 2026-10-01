import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { getConfigDir } from '../settings-service.js';
import { backupSourcesFor, EXTERNAL_ANCHOR_PREFIX, resolveArchiveRelPath } from '../data-registry.js';
import {
  BACKUP_CATEGORIES,
  GLOBAL_SCOPE,
  getCategoryDef,
  listWorkspaceIds,
  resolveCategoryConfig,
  type BackupCategoryKey,
  type BackupConfig,
  type BackupFrequency,
  type BackupScope,
} from './categories.js';
import {
  backupDirPath,
  backupFileName,
  backupZipPath,
  isBackupFileName,
  listBackupFiles,
  packSources,
  pruneOld,
} from './zip-pack.js';
import { isDue, startScheduler, stopScheduler, type BackupConfigProvider } from './schedule.js';

export * from './categories.js';
export { isDue, type BackupConfigProvider } from './schedule.js';
export { type BackupFileInfo } from './zip-pack.js';

const queues = new Map<string, Promise<void>>();

async function enqueue<T>(queueKey: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(queueKey) ?? Promise.resolve();
  const run = prev.then(task, task);
  queues.set(
    queueKey,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

const inFlight = new Set<string>();

function scopeQueueKey(category: BackupCategoryKey, scope: BackupScope): string {
  return `${scope}:${category}`;
}

export interface BackupRunResult {
  key: BackupCategoryKey;
  scope: BackupScope;
  /** null = 无有效源内容，未产生备份文件 */
  fileName: string | null;
  size: number;
  pruned: string[];
  error?: string;
}

export interface RunBackupOptions {
  keep?: number;
}

export async function runBackup(
  category: BackupCategoryKey,
  scope: BackupScope,
  opts?: RunBackupOptions,
): Promise<BackupRunResult> {
  const keep = opts?.keep ?? getCategoryDef(category).defaultConfig.keep;
  const queueKey = scopeQueueKey(category, scope);
  return enqueue(queueKey, async () => {
    inFlight.add(queueKey);
    try {
      return await runBackupInner(category, scope, keep);
    } finally {
      inFlight.delete(queueKey);
    }
  });
}

/** 同 scope+key 同秒两次备份会撞文件名且后写覆盖前写（预备份覆盖原备份），秒数递增避让 */
async function uniqueBackupFileName(category: BackupCategoryKey, scope: BackupScope): Promise<string> {
  let d = new Date();
  for (let i = 0; i < 60; i++) {
    const name = backupFileName(category, d);
    const exists = await fs.stat(backupZipPath(scope, name)).then(
      () => true,
      () => false,
    );
    if (!exists) return name;
    d = new Date(d.getTime() + 1000);
  }
  throw new Error('无法生成唯一备份文件名');
}

/** 仅在队列任务体内调用（重入 enqueue 同 key 会死锁）；预备份也走这里 */
async function runBackupInner(
  category: BackupCategoryKey,
  scope: BackupScope,
  keep: number,
): Promise<BackupRunResult> {
  const sources = await backupSourcesFor(category, scope);
  const fileName = await uniqueBackupFileName(category, scope);
  const zipPath = backupZipPath(scope, fileName);
  await fs.mkdir(backupDirPath(scope), { recursive: true });
  const entries = await packSources(sources, zipPath);
  if (entries === 0) {
    await fs.rm(zipPath, { force: true });
    return { key: category, scope, fileName: null, size: 0, pruned: [] };
  }
  const pruned = await pruneOld(scope, category, keep);
  const st = await fs.stat(zipPath);
  return { key: category, scope, fileName, size: st.size, pruned };
}

export interface RunAllOptions {
  /** 调度 tick 用：只跑到期分类，且该 scope+key 进行中则跳过 */
  onlyDue?: boolean;
}

/** 遍历所有分类×适用 scope 执行备份；单分类失败不中断其他分类 */
export async function runBackupAll(config?: BackupConfig | null, opts?: RunAllOptions): Promise<BackupRunResult[]> {
  const results: BackupRunResult[] = [];
  const workspaceIds = await listWorkspaceIds();
  for (const def of BACKUP_CATEGORIES) {
    const conf = resolveCategoryConfig(def, config ?? undefined);
    if (!conf.enabled) continue;
    for (const scopeType of def.scopes) {
      const scopes = scopeType === 'global' ? [GLOBAL_SCOPE] : workspaceIds;
      for (const scope of scopes) {
        if (opts?.onlyDue) {
          if (inFlight.has(scopeQueueKey(def.key, scope))) continue;
          if (!(await isDue(def.key, scope, conf.frequency))) continue;
        }
        try {
          results.push(await runBackup(def.key, scope, { keep: conf.keep }));
        } catch (err) {
          results.push({
            key: def.key,
            scope,
            fileName: null,
            size: 0,
            pruned: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
  return results;
}

/** 调度 tick 入口：只跑启用且到期的分类 */
export async function runDueBackups(config?: BackupConfig | null): Promise<BackupRunResult[]> {
  return runBackupAll(config, { onlyDue: true });
}

export interface BackupEntry {
  fileName: string;
  time: string;
  size: number;
}

export async function listBackups(category: BackupCategoryKey, scope: BackupScope): Promise<BackupEntry[]> {
  const files = await listBackupFiles(scope, category);
  return files
    .map((f) => ({ fileName: f.fileName, time: f.stamp.toISOString(), size: f.size }))
    .reverse();
}

export interface RestoreResult {
  /** 恢复前自动预备份的文件名（null = 恢复源为空包，未预备份） */
  preBackupFileName: string | null;
  /** 实际写回的条目（zip 内相对路径） */
  restored: string[];
}

/**
 * 恢复到原位：先同分类预备份当前状态（失败即中止），再按 zip 内相对路径反解写回
 * targetRoot 缺省为 configDir；zip 内路径越界（zip slip）直接抛错
 */
export async function restoreBackup(
  category: BackupCategoryKey,
  scope: BackupScope,
  fileName: string,
  targetRoot?: string,
): Promise<RestoreResult> {
  if (!isBackupFileName(category, fileName)) {
    throw new Error(`非法备份文件名: ${fileName}`);
  }
  const zipPath = backupZipPath(scope, fileName);
  return enqueue(scopeQueueKey(category, scope), async () => {
    let preFileName: string | null = null;
    try {
      const pre = await runBackupInner(category, scope, getCategoryDef(category).defaultConfig.keep);
      preFileName = pre.fileName;
    } catch (err) {
      throw new Error(`预备份失败，已中止恢复: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!(await fs.stat(zipPath).then(
      (st) => st.isFile(),
      () => false,
    ))) {
      throw new Error(`备份文件不存在: ${fileName}`);
    }
    const restored = await extractZipTo(zipPath, targetRoot ?? getConfigDir());
    return { preBackupFileName: preFileName, restored };
  });
}

async function extractZipTo(zipPath: string, targetRoot: string): Promise<string[]> {
  const root = path.resolve(targetRoot);
  const zip = new AdmZip(zipPath);
  const restored: string[] = [];
  for (const entry of zip.getEntries()) {
    let target: string;
    if (entry.entryName.split('/')[0] === EXTERNAL_ANCHOR_PREFIX) {
      const resolved = await resolveArchiveRelPath(entry.entryName);
      if (!resolved) {
        console.warn(`[backup] 条目无法反解（工作区已注销或路径非法），跳过: ${entry.entryName}`);
        continue;
      }
      target = path.resolve(resolved);
    } else {
      target = path.resolve(root, entry.entryName);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error(`备份条目路径越界: ${entry.entryName}`);
      }
    }
    if (entry.isDirectory) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.getData());
    restored.push(entry.entryName);
  }
  return restored;
}

export interface BackupScopeStatus {
  key: BackupCategoryKey;
  scope: BackupScope;
  scopeType: 'workspace' | 'global';
  enabled: boolean;
  frequency: BackupFrequency;
  keep: number;
  count: number;
  lastBackupAt: string | null;
  /** 启用且到期（manual 恒 false） */
  due: boolean;
}

export async function getBackupStatus(config?: BackupConfig | null): Promise<BackupScopeStatus[]> {
  const out: BackupScopeStatus[] = [];
  const workspaceIds = await listWorkspaceIds();
  for (const def of BACKUP_CATEGORIES) {
    const conf = resolveCategoryConfig(def, config ?? undefined);
    for (const scopeType of def.scopes) {
      const scopes = scopeType === 'global' ? [GLOBAL_SCOPE] : workspaceIds;
      for (const scope of scopes) {
        const files = await listBackupFiles(scope, def.key);
        const last = files.at(-1);
        out.push({
          key: def.key,
          scope,
          scopeType,
          enabled: conf.enabled,
          frequency: conf.frequency,
          keep: conf.keep,
          count: files.length,
          lastBackupAt: last ? last.stamp.toISOString() : null,
          due: conf.enabled && (await isDue(def.key, scope, conf.frequency)),
        });
      }
    }
  }
  return out;
}

/** step3 接线 settings 后由主进程启动入口调用 */
export function startBackupScheduler(getConfig: BackupConfigProvider): void {
  startScheduler(getConfig, runDueBackups);
}

export function stopBackupScheduler(): void {
  stopScheduler();
}
