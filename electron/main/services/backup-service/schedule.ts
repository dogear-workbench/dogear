import {
  type BackupCategoryKey,
  type BackupConfig,
  type BackupFrequency,
  type BackupScope,
} from './categories.js';
import { listBackupFiles } from './zip-pack.js';
import { readCategoryRun, recordSchedulerRun } from './last-run.js';

const TICK_MS = 30 * 60 * 1000;

const FREQ_INTERVAL_MS: Record<Exclude<BackupFrequency, 'manual'>, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/** 到期锚点 = max(最新 zip 时间戳, last-run 该 key 执行时间)：跳过记录也能推进锚点，避免每 tick 空转重算签名 */
export async function isDue(
  category: BackupCategoryKey,
  scope: BackupScope,
  frequency: BackupFrequency,
): Promise<boolean> {
  if (frequency === 'manual') return false;
  const [files, lastRun] = await Promise.all([listBackupFiles(scope, category), readCategoryRun(category, scope)]);
  const zipTime = files.at(-1)?.stamp.getTime() ?? 0;
  const runTime = lastRun ? Date.parse(lastRun.time) : NaN;
  const anchor = Math.max(zipTime, Number.isNaN(runTime) ? 0 : runTime);
  if (anchor === 0) return true;
  return Date.now() - anchor >= FREQ_INTERVAL_MS[frequency];
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backup] 调度 tick 失败: ${msg}`);
    try {
      await recordSchedulerRun(false, msg);
    } catch (recordErr) {
      console.error(`[backup] last-run 记录失败: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`);
    }
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
