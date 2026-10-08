import fs from 'fs/promises';
import path from 'path';
import { getConfigDir } from '../settings-service.js';
import type { BackupCategoryKey, BackupScope } from './categories.js';

/** backups/ 目录内的调度观测文件：registry 排除项，不参与备份与同步 */
export interface LastRunEntry {
  time: string;
  category: string | null;
  scope: string | null;
  ok: boolean;
  error: string | null;
  /** 上次成功备份时的源签名；null = 源无内容；undefined = 旧版记录（首次必打一份重建签名） */
  signature?: string | null;
  /** 该次执行为无变化跳过（ok 恒 true、signature 保留上次值） */
  skipped?: boolean;
}

export interface CategoryRunExtra {
  /** undefined = 保留记录中已有值（跳过与失败路径均不改签名） */
  signature?: string | null;
  skipped?: boolean;
}

interface LastRunFile {
  /** key = `${scope}:${category}`，新结果按 key 覆盖 */
  runs: Record<string, LastRunEntry>;
  scheduler: LastRunEntry | null;
}

const emptyFile = (): LastRunFile => ({ runs: {}, scheduler: null });

export function lastRunFilePath(): string {
  return path.join(getConfigDir(), 'backups', 'last-run.json');
}

function runKey(scope: string, category: string): string {
  return `${scope}:${category}`;
}

function toEntry(category: string | null, scope: string | null, ok: boolean, error: string | null): LastRunEntry {
  return { time: new Date().toISOString(), category, scope, ok, error };
}

let writeChain: Promise<unknown> = Promise.resolve();

/** 并行备份不同分类共用一个文件，读写必须串行化避免读改写互踩 */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readLastRun(): Promise<LastRunFile> {
  try {
    const raw = JSON.parse(await fs.readFile(lastRunFilePath(), 'utf8')) as Partial<LastRunFile>;
    return { runs: raw.runs ?? {}, scheduler: raw.scheduler ?? null };
  } catch {
    // 必须返回新对象：record 的读改写会直接 mutate 返回值，共享单例会被永久污染
    return emptyFile();
  }
}

async function writeLastRun(data: LastRunFile): Promise<void> {
  await fs.mkdir(path.dirname(lastRunFilePath()), { recursive: true });
  await fs.writeFile(lastRunFilePath(), JSON.stringify(data, null, 2));
}

export function recordCategoryRun(
  category: BackupCategoryKey,
  scope: BackupScope,
  ok: boolean,
  error: string | null,
  extra?: CategoryRunExtra,
): Promise<void> {
  return enqueueWrite(async () => {
    const data = await readLastRun();
    const key = runKey(scope, category);
    const prev = data.runs[key];
    const entry = toEntry(category, scope, ok, error);
    const signature = extra?.signature !== undefined ? extra.signature : prev?.signature;
    if (signature !== undefined) entry.signature = signature;
    if (extra?.skipped) entry.skipped = true;
    data.runs[key] = entry;
    await writeLastRun(data);
  });
}

export function recordSchedulerRun(ok: boolean, error: string | null): Promise<void> {
  return enqueueWrite(async () => {
    const data = await readLastRun();
    data.scheduler = toEntry(null, null, ok, error);
    await writeLastRun(data);
  });
}

export async function readCategoryRun(category: BackupCategoryKey, scope: BackupScope): Promise<LastRunEntry | null> {
  return (await readLastRun()).runs[runKey(scope, category)] ?? null;
}

export async function readSchedulerRun(): Promise<LastRunEntry | null> {
  return (await readLastRun()).scheduler;
}
