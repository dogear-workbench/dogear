import {
  type BackupCategoryKey,
  type BackupConfig,
  type BackupFrequency,
  type BackupScope,
} from './categories.js';
import { listBackupFiles } from './zip-pack.js';

const TICK_MS = 30 * 60 * 1000;

const FREQ_INTERVAL_MS: Record<Exclude<BackupFrequency, 'manual'>, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/** 到期判断零状态：扫备份目录最新文件名时间戳 vs 频率间隔；manual 永不自动触发 */
export async function isDue(
  category: BackupCategoryKey,
  scope: BackupScope,
  frequency: BackupFrequency,
): Promise<boolean> {
  if (frequency === 'manual') return false;
  const files = await listBackupFiles(scope, category);
  const latest = files.at(-1);
  if (!latest) return true;
  return Date.now() - latest.stamp.getTime() >= FREQ_INTERVAL_MS[frequency];
}

export type BackupConfigProvider = () => Promise<BackupConfig | null> | BackupConfig | null;
export type RunDueFn = (config: BackupConfig | null) => Promise<unknown>;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let runDue: RunDueFn | null = null;

async function tick(): Promise<void> {
  if (ticking || !runDue) return;
  ticking = true;
  try {
    await runDue(await resolveConfig());
  } catch {
    // 调度失败静默，下轮 tick 重试
  } finally {
    ticking = false;
  }
}

let configProvider: BackupConfigProvider | null = null;

async function resolveConfig(): Promise<BackupConfig | null> {
  if (!configProvider) return null;
  return (await Promise.resolve(configProvider())) ?? null;
}

/** runDue 由 index.ts 注入（避免 schedule → index 循环依赖）；启动即查 + 每 30 分钟 tick */
export function startScheduler(getConfig: BackupConfigProvider, runDueFn: RunDueFn): void {
  configProvider = getConfig;
  runDue = runDueFn;
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  void tick();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  configProvider = null;
  runDue = null;
}
