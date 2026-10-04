import fsp from 'node:fs/promises';
import { createWriteStream, createReadStream, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FileEntry, FilePushMeta, SkippedEntry } from './protocol.js';
import { isExcluded, type ManifestExcludes } from './manifest.js';
import { EXTERNAL_ANCHOR_PREFIX, EXTERNAL_TASKS_REL, resolveExternalRelPath } from '../data-registry.js';
import { loadSettings, saveSettings, type AppSettings, type PairedDevice } from '../settings-service.js';
import { normalizeSyncOptions, SETTINGS_SYNC_FIELDS, type SyncOptions } from '../settings-types.js';
import { getOrCreateDeviceId } from './device.js';
import { safeJsonWrite } from '../safe-json.js';
import {
  mergeArrayFile,
  mergeRecordMapFile,
  mergeWorkspacesFile,
  type ParsedJson,
} from './merge-records.js';
import { readSyncStateFrom, withSyncStateLock, writeSyncStateTo } from './sync-state.js';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  const aa = a as Record<string, unknown>;
  const bb = b as Record<string, unknown>;
  return ka.every((k) => deepEqual(aa[k], bb[k]));
}

const SETTINGS_MERGE_WARN_MAX = 5;

const SETTINGS_SYNC_FIELD_SET: ReadonlySet<string> = new Set(SETTINGS_SYNC_FIELDS);

/** 白名单外字段（机器亲和/敏感/未知新字段）一律保本端：本端没有的键不凭空造，落盘默认值由 saveSettings/loadSettings 兜底 */
function takeLocalExceptSyncFields(
  merged: Record<string, unknown>,
  local: Record<string, unknown>,
): void {
  for (const key of Object.keys(local)) {
    if (!SETTINGS_SYNC_FIELD_SET.has(key)) merged[key] = local[key];
  }
}

/**
 * settings.json 顶层字段级三方合并（D2 + 白名单传播制）：仅 SETTINGS_SYNC_FIELDS 白名单字段逐字段与基线比——
 * 单侧变取变侧，双侧都变且不等取本端并记 warning（双侧改成同值不算冲突），两侧同基线保留；
 * 白名单外字段（含未知新字段）一律保本端、双改不警告。字段新增/删除同样适用（基线缺该键视为 undefined）。
 */
function mergeFieldsThreeWay(
  local: Record<string, unknown>,
  incoming: Record<string, unknown>,
  baseline: Record<string, unknown>,
  onWarning?: (message: string) => void,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of SETTINGS_SYNC_FIELDS) {
    const l = local[key];
    const i = incoming[key];
    const b = baseline[key];
    const localChanged = !deepEqual(l, b);
    const incomingChanged = !deepEqual(i, b);
    const doubleChanged = localChanged && incomingChanged && !deepEqual(l, i);
    const chosen = doubleChanged || localChanged ? l : i;
    // JSON 无 undefined：chosen === undefined 即三方均无此键（含双侧一致删除），不设键
    if (chosen !== undefined) merged[key] = chosen;
    if (doubleChanged) conflicts.push(key);
  }
  takeLocalExceptSyncFields(merged, local);
  if (conflicts.length > 0 && onWarning) {
    const shown = conflicts.slice(0, SETTINGS_MERGE_WARN_MAX).join('、');
    const more = conflicts.length > SETTINGS_MERGE_WARN_MAX ? ` 等 ${conflicts.length} 个字段` : '';
    onWarning(`settings 字段 ${shown}${more} 两端都修改过，已保留本端版本（对端版本被丢弃）`);
  }
  return merged;
}

const INCOMING_SUFFIX = '.dogear-incoming';

export function resolveWithinDataDir(dataDir: string, relPath: string): string | null {
  if (relPath.includes('\\') || relPath.startsWith('/')) return null;
  if (!relPath.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')) return null;
  const abs = path.resolve(dataDir, relPath);
  const base = path.resolve(dataDir);
  return abs.startsWith(base + path.sep) ? abs : null;
}

const VIRTUAL_PREFIX = `${EXTERNAL_ANCHOR_PREFIX}/`;

/** 同步条目落盘/读盘统一解析：虚拟路径反解到工作区真实路径，其余限 configDir 内 */
export async function resolveIncomingRelPath(root: string, relPath: string): Promise<string | null> {
  return relPath.startsWith(VIRTUAL_PREFIX) ? resolveExternalRelPath(root, relPath) : resolveWithinDataDir(root, relPath);
}

function unsafeReason(relPath: string): string {
  return relPath.startsWith(VIRTUAL_PREFIX)
    ? `虚拟路径反解失败（工作区未注册或路径不安全）: ${relPath}`
    : 'unsafe path';
}

export interface IncomingWriteResult {
  ok: true;
  absPath: string;
  bytesWritten: number;
}

export interface IncomingWriteError {
  ok: false;
  reason: string;
}

export async function writeIncomingFile(
  dataDir: string,
  meta: FilePushMeta,
  source: Readable,
): Promise<IncomingWriteResult | IncomingWriteError> {
  const absPath = await resolveIncomingRelPath(dataDir, meta.relPath);
  if (!absPath) return { ok: false, reason: unsafeReason(meta.relPath) };
  const tmpPath = `${absPath}.${Date.now().toString(36)}${INCOMING_SUFFIX}`;
  try {
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await pipeline(source, createGunzip(), createWriteStream(tmpPath));
    const st = await fsp.stat(tmpPath);
    await fsp.utimes(tmpPath, new Date(meta.mtimeMs), new Date(meta.mtimeMs));
    await fsp.rename(tmpPath, absPath);
    return { ok: true, absPath, bytesWritten: st.size };
  } catch (error) {
    await fsp.unlink(tmpPath).catch(() => {});
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function toMeta(entry: FileEntry): FilePushMeta {
  return { relPath: entry.relPath, size: entry.size, mtimeMs: entry.mtimeMs };
}

export function shortDeviceId(deviceId: string): string {
  return deviceId.replace(/-/g, '').slice(0, 6);
}

/** 副本名时间戳段：本地时间 YYYYMMDD-HHmmss，让同一文件多轮冲突的副本不再互相覆盖（D3） */
function conflictTimestampSegment(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 冲突副本同目录同名：`<name>.<ext>.conflict-<胜方设备短ID>-<YYYYMMDD-HHmmss>-<rand4>`；
 * 时间戳+随机段防同秒多副本覆盖（D3）；dotfile 整体作 stem */
export function conflictCopyRelPath(relPath: string, winnerShortId: string): string {
  const slash = relPath.lastIndexOf('/');
  const dir = slash >= 0 ? relPath.slice(0, slash + 1) : '';
  const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  const rand = randomBytes(2).toString('hex');
  return `${dir}${stem}${ext}.conflict-${winnerShortId}-${conflictTimestampSegment()}-${rand}`;
}

async function saveLocalConflictCopy(root: string, relPath: string, winnerShortId: string): Promise<void> {
  const abs = await resolveIncomingRelPath(root, relPath);
  if (!abs) throw new Error(unsafeReason(relPath));
  const copyRel = conflictCopyRelPath(relPath, winnerShortId);
  const copyAbs = await resolveIncomingRelPath(root, copyRel);
  if (!copyAbs) throw new Error(unsafeReason(copyRel));
  await fsp.mkdir(path.dirname(copyAbs), { recursive: true });
  // COPYFILE_EXCL：撞名时报错而非覆盖旧副本（调用方降级 skipped，绝不静默丢留底）
  await fsp.copyFile(abs, copyAbs, fsConstants.COPYFILE_EXCL);
}

async function readGzipText(source: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    source.on('error', reject);
    source
      .pipe(createGunzip())
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      .on('error', reject);
  });
}

function mergePairedDevices(local: PairedDevice[], incoming: unknown): PairedDevice[] {
  const byId = new Map(local.map((d) => [d.deviceId, d]));
  const remote = Array.isArray(incoming) ? (incoming as unknown[]) : [];
  for (const item of remote) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Partial<PairedDevice>;
    if (typeof d.deviceId !== 'string' || d.deviceId === '') continue;
    if (typeof d.secret !== 'string' || d.secret === '') continue;
    if (byId.has(d.deviceId)) continue;
    byId.set(d.deviceId, {
      deviceId: d.deviceId,
      ...(typeof d.deviceName === 'string' && d.deviceName !== '' ? { deviceName: d.deviceName } : {}),
      secret: d.secret,
      pairedAt: typeof d.pairedAt === 'number' && Number.isFinite(d.pairedAt) ? d.pairedAt : Date.now(),
    });
  }
  return [...byId.values()];
}

// ─── 记录型文件条目级合并（merge registry）───

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * settings.json 合并核心：白名单字段三方合并（有基线）或以对端为底（无基线，首次同步），
 * 白名单外字段（含未知新字段）两条路径都保本端。
 * syncOptions 节维持 rev-LWW 特判：deviceName 保本端、pairedDevices 并集（secret 冲突取本端、剔除自身条目），
 * 其余范围字段（syncStocksData/syncFeishu/disabledSyncItems/syncConflictCopies/syncShadowGit/userSyncPaths）整组原子取
 * syncOptionsRev 大的一端（两端统一机制，设计 §3.2）：rev 缺省按 0；rev 相同但内容不同（离线各自改的竞态）
 * 保本端、不落副本、下轮收敛。localSyncOptions 可注入（单测）；缺省走 loadSettings（含默认值兜底）。
 */
export interface SettingsMergeOptions {
  /** 单测注入完整本端 settings（优先于 loadSettings/localSyncOptions）：三方字段测试不走进程级 env 读盘 */
  localSettings?: AppSettings;
  /** 单测注入本端 syncOptions；缺省读盘。注入时非 syncOptions 字段的 local 以 incoming 为底（仅测特判用） */
  localSyncOptions?: SyncOptions;
  /** per-peer 基线（上次同步收敛后的 settings.json 内容）；缺省/null = 无基线退化行为 */
  baseline?: Record<string, unknown> | null;
  /** 双改字段 warning 回调：pull 侧进 report.warnings，push 接收端 console.warn */
  onWarning?: (message: string) => void;
}

export async function computeMergedSettings(
  incoming: Record<string, unknown>,
  options: SettingsMergeOptions = {},
): Promise<AppSettings> {
  const local = options.localSettings
    ? options.localSettings
    : options.localSyncOptions
      ? ({ ...incoming, syncOptions: options.localSyncOptions } as unknown as AppSettings)
      : await loadSettings();
  const baseline = options.baseline && typeof options.baseline === 'object' && !Array.isArray(options.baseline)
    ? options.baseline
    : null;
  const localRecord = local as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = baseline
    ? mergeFieldsThreeWay(localRecord, incoming, baseline, options.onWarning)
    : (() => {
        // 无基线（首次同步）退化：白名单字段以对端为底初始化，白名单外仍保本端不被污染
        const m: Record<string, unknown> = {};
        for (const key of SETTINGS_SYNC_FIELDS) {
          if (incoming[key] !== undefined) m[key] = incoming[key];
        }
        takeLocalExceptSyncFields(m, localRecord);
        return m;
      })();
  // 本端读盘已过 normalizeSyncOptions；对端是不可信输入，同样归一化（非法值滤除、缺省补齐）
  const localSync = normalizeSyncOptions(local.syncOptions);
  const incomingSync = normalizeSyncOptions(incoming.syncOptions);
  const selfDeviceId = await getOrCreateDeviceId();
  const localRev = localSync.syncOptionsRev ?? 0;
  const incomingRev = incomingSync.syncOptionsRev ?? 0;
  const scopeFromIncoming = incomingRev > localRev;
  merged.syncOptions = {
    deviceName: localSync.deviceName,
    syncStocksData: scopeFromIncoming ? incomingSync.syncStocksData : localSync.syncStocksData,
    syncFeishu: scopeFromIncoming ? incomingSync.syncFeishu : localSync.syncFeishu,
    pairedDevices: mergePairedDevices(localSync.pairedDevices, incomingSync.pairedDevices)
      .filter((d) => d.deviceId !== selfDeviceId),
    disabledSyncItems: scopeFromIncoming ? incomingSync.disabledSyncItems : localSync.disabledSyncItems,
    syncConflictCopies: scopeFromIncoming ? incomingSync.syncConflictCopies : localSync.syncConflictCopies,
    syncShadowGit: scopeFromIncoming ? incomingSync.syncShadowGit : localSync.syncShadowGit,
    userSyncPaths: scopeFromIncoming ? incomingSync.userSyncPaths : localSync.userSyncPaths,
    // 保本端时维持本端 rev；采纳对端时采纳对端 rev（下轮不再反复拉扯）
    syncOptionsRev: Math.max(localRev, incomingRev),
  };
  return merged as unknown as AppSettings;
}

/** 读 dataDir 下 settings.json 磁盘原文（不 deepMerge 默认值）：合并与基线统一用磁盘形态，与 loadSettings 的默认值填充形态区分，否则缺省字段会被误判为「本端改过」 */
export async function readSettingsRaw(dataDir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fsp.readFile(path.join(dataDir, 'settings.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface SettingsPushContext {
  dataDir: string;
  peerDeviceId: string;
}

/**
 * push 接收端 settings.json 合并入口（server.ts handleFilePush 调用；pull 端走 applyIncoming 合并路径）：
 * 锁内读 per-peer 基线 → 三方合并 → saveSettings 落盘 → 基线更新为落盘结果，整段原子（F5）。
 * 双改 warning 本端仅 console.warn（无反向通道告知发起端）。
 */
export async function mergeIncomingSettings(source: Readable, ctx: SettingsPushContext): Promise<void> {
  const raw = await readGzipText(source);
  const incoming = JSON.parse(raw) as Record<string, unknown>;
  await withSyncStateLock(ctx.dataDir, async () => {
    const state = await readSyncStateFrom(ctx.dataDir);
    const warnings: string[] = [];
    const merged = await computeMergedSettings(incoming, {
      localSettings: ((await readSettingsRaw(ctx.dataDir)) ?? undefined) as unknown as AppSettings | undefined,
      baseline: state.peers[ctx.peerDeviceId]?.settingsBaseline ?? null,
      onWarning: (message) => warnings.push(message),
    });
    await saveSettings(merged);
    const peer = state.peers[ctx.peerDeviceId] ?? { deviceId: ctx.peerDeviceId, lastSyncAt: 0 };
    state.peers[ctx.peerDeviceId] = peer;
    peer.settingsBaseline = merged as unknown as Record<string, unknown>;
    await writeSyncStateTo(ctx.dataDir, state);
    for (const message of warnings) console.warn(`[lan-sync] settings 合并: ${message}`);
  });
}

/** merge 调用上下文：仅 settings.json pattern 消费（per-peer 三方基线与 warning 回调），其余 pattern 忽略 */
interface MergeCallCtx {
  settingsBaseline?: Record<string, unknown> | null;
  onWarning?: (message: string) => void;
}

type MergeFn = (
  local: ParsedJson,
  remote: ParsedJson,
  ctx?: MergeCallCtx,
) => ParsedJson | null | Promise<ParsedJson | null>;

interface MergePattern {
  test: (relPath: string) => boolean;
  /** 本端解析结果（文件缺失为 null）+ 对端解析结果 → 合并后对象；返回 null = 合并失败（调用方降级挂起，不覆盖本端） */
  merge: MergeFn;
  /** 合并结果落盘；缺省 = safeJsonWrite 原子写 + mtime 取 max(本端, 对端 entry) */
  persist?: (absPath: string, merged: unknown) => Promise<void>;
}

/**
 * 记录型文件条目级合并模式表：命中者 applyIncoming 走合并落盘而非整文件覆盖。
 * 「两端各自追加条目」的文件靠合并收敛（幂等），不走 LWW/人工裁决。
 */
const MERGE_PATTERNS: MergePattern[] = [
  {
    test: (relPath) => relPath === 'settings.json',
    merge: async (local, remote, ctx) => {
      const incoming = remote !== null && typeof remote === 'object' && !Array.isArray(remote)
        ? (remote as Record<string, unknown>)
        : null;
      if (!incoming) return null;
      // local = 本端磁盘原文（applyMergedIncoming 读的 root 文件），注入保证 local/基线/对端三态同源；
      // 本端文件缺失/异常时回落 loadSettings（无本端数据可丢，行为同无基线退化）
      const localObj = local !== null && typeof local === 'object' && !Array.isArray(local)
        ? (local as unknown as AppSettings)
        : undefined;
      return await computeMergedSettings(incoming, {
        ...(localObj ? { localSettings: localObj } : {}),
        baseline: ctx?.settingsBaseline ?? null,
        onWarning: ctx?.onWarning,
      });
    },
    // settings 走 saveSettings（默认值合并 + nativeTheme 副作用），与原 mergeIncomingSettings 行为一致
    persist: async (_absPath, merged) => {
      await saveSettings(merged as AppSettings);
    },
  },
  // workspace id 并集；同 id path/additionalPaths/isDefault 保本端（机器亲和），name/createdAt 取更早
  { test: (relPath) => relPath === 'workspaces/workspaces.json', merge: mergeWorkspacesFile },
  // sessionId 并集；同 id updatedAt（ISO 字符串）新者胜
  {
    test: (relPath) => /^workspaces\/[^/]+\/conversations\.json$/.test(relPath),
    merge: (local, remote) => mergeRecordMapFile(local, remote, 'conversations'),
  },
  // group id 并集；同 id updatedAt（毫秒数）新者胜
  {
    test: (relPath) => /^workspaces\/[^/]+\/groups\.json$/.test(relPath),
    merge: (local, remote) => mergeArrayFile(local, remote, 'groups', 'id'),
  },
  // task id 并集；同 id updatedAt（ISO 字符串）新者胜（结构 {version:2,tasks:[]}，已核对 task-store.ts）；
  // 工作区任务虚拟条目同构（version 3），合并后 version 取较大者
  { test: (relPath) => relPath === 'plans.json', merge: (local, remote) => mergeArrayFile(local, remote, 'tasks', 'id') },
  {
    test: (relPath) => relPath.startsWith(VIRTUAL_PREFIX) && relPath.endsWith(`/${EXTERNAL_TASKS_REL}`),
    merge: (local, remote) => mergeArrayFile(local, remote, 'tasks', 'id'),
  },
  // 通知 id 并集；同 id 新者胜（条目无 updatedAt，按 createdAt 比较）
  { test: (relPath) => relPath === 'notifications.json', merge: (local, remote) => mergeArrayFile(local, remote, 'entries', 'id') },
];

/** relPath 是否命中 merge registry（orchestrator 用它把 conflict 条目路由到合并而非 LWW/挂起） */
export function matchMergePattern(relPath: string): boolean {
  return MERGE_PATTERNS.some((p) => p.test(relPath));
}

export interface IncomingApplyItem {
  entry: FileEntry;
  /** 双改冲突且对端胜时为 true：先以本端当前内容落 conflict-<对端短ID> 副本，副本成功才允许覆盖本端文件 */
  saveConflictCopyBeforeOverwrite?: boolean;
  conflictWinnerShortId?: string;
  /**
   * 对端原始 relPath（工作区映射折算后 entry.relPath 为本端视角路径）：拉取文件向对端请求时用。
   * 缺省 = entry.relPath（全局数据无折算）。
   */
  remoteRelPath?: string;
}

export type IncomingSourceFactory = (relPath: string) => Promise<Readable>;
export interface IncomingApplyReport {
  applied: FileEntry[];
  skipped: SkippedEntry[];
  /** 命中 merge registry 且条目级合并成功落盘的文件（落盘为合并结果而非对端原样，baseline 需重算 hash） */
  mergedFiles: string[];
  /** 合并失败（任一侧 JSON 解析失败/结构异常）：未写本端，调用方降级进待处理冲突，绝不静默覆盖 */
  mergeFailed: SkippedEntry[];
}

export interface IncomingApplyOptions {
  /** settings.json 三方合并基线（per-peer，来自 sync-state）；缺省 = 无基线退化行为 */
  settingsBaseline?: Record<string, unknown> | null;
  /** settings 双改字段 warning 收集（orchestrator 转 report.warnings） */
  onSettingsMergeWarning?: (message: string) => void;
}

export async function applyIncoming(
  root: string,
  items: IncomingApplyItem[],
  sourceFactory: IncomingSourceFactory,
  excludes?: ManifestExcludes,
  options?: IncomingApplyOptions,
): Promise<IncomingApplyReport> {
  const report: IncomingApplyReport = { applied: [], skipped: [], mergedFiles: [], mergeFailed: [] };
  for (const item of items) {
    const { entry } = item;
    // 应用侧对称过滤：挡住旧版本对端（未按本端范围排除）推来的路径，双保险。
    // 在 merge 路由之前判断：被排除的记录文件也不进条目级合并
    if (isExcluded(entry.relPath, excludes)) {
      report.skipped.push({ relPath: entry.relPath, reason: '本端同步范围已排除，丢弃对端推送' });
      continue;
    }
    const remoteRelPath = item.remoteRelPath ?? entry.relPath;
    try {
      // 条目级合并路径：不整文件覆盖本端、不落冲突副本（合并天然保两侧条目，无丢失风险）。
      // 带 saveConflictCopyBeforeOverwrite 的条目不进合并：它来自用户显式裁决「取对端」
      // （典型为本端文件损坏后的救援），必须整文件覆盖且先落本端副本。
      if (!item.saveConflictCopyBeforeOverwrite && matchMergePattern(entry.relPath)) {
        await applyMergedIncoming(root, item, sourceFactory, report, options);
        continue;
      }
      if (item.saveConflictCopyBeforeOverwrite) {
        await saveLocalConflictCopy(root, entry.relPath, item.conflictWinnerShortId ?? 'unknown');
      }
      const source = await sourceFactory(remoteRelPath);
      const result = await writeIncomingFile(root, toMeta(entry), source);
      if (!result.ok) {
        report.skipped.push({ relPath: entry.relPath, reason: result.reason });
        continue;
      }
      report.applied.push(entry);
    } catch (error) {
      report.skipped.push({
        relPath: entry.relPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

/**
 * 条目级合并路径：本端当前文本 + 对端文本 → registry 合并 → 落盘。
 * 本端无此文件 → 直接按对端内容落盘（无本端数据可丢）。
 * 任一侧 JSON 解析失败/结构异常 → mergeFailed（未写本端），由调用方降级进待处理冲突。
 */
async function applyMergedIncoming(
  root: string,
  item: IncomingApplyItem,
  sourceFactory: IncomingSourceFactory,
  report: IncomingApplyReport,
  options?: IncomingApplyOptions,
): Promise<void> {
  const entry = item.entry;
  const absPath = await resolveIncomingRelPath(root, entry.relPath);
  if (!absPath) {
    report.skipped.push({ relPath: entry.relPath, reason: unsafeReason(entry.relPath) });
    return;
  }
  const source = await sourceFactory(item.remoteRelPath ?? entry.relPath);
  const remoteRaw = await readGzipText(source);

  let remoteParsed: ParsedJson;
  try {
    remoteParsed = JSON.parse(remoteRaw);
  } catch (error) {
    report.mergeFailed.push({ relPath: entry.relPath, reason: `对端文件解析失败: ${errText(error)}` });
    return;
  }

  // 本端无此文件：无本端数据可丢，直接按对端内容落盘（沿用整文件写入路径，保持对端 mtime）
  let localRaw: string | null = null;
  try {
    localRaw = await fsp.readFile(absPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      report.mergeFailed.push({ relPath: entry.relPath, reason: `本端文件读取失败: ${errText(error)}` });
      return;
    }
  }

  if (localRaw === null) {
    // 本端无此文件：无本端数据可丢，直接按对端内容落盘。注意 source 已被 readGzipText 消费（流不可重读，
    // 二次 pipeline 会 Z_BUF_ERROR），remoteParsed 即对端解压后内容，直接原子写 + 保持对端 mtime
    const mtimeMs = entry.mtimeMs;
    await safeJsonWrite(absPath, remoteParsed);
    try {
      await fsp.utimes(absPath, new Date(mtimeMs), new Date(mtimeMs));
    } catch {
      // mtime 设置失败不影响数据正确性
    }
    report.applied.push(entry);
    return;
  }

  let localParsed: ParsedJson;
  let localMtimeMs = 0;
  try {
    try {
      localMtimeMs = (await fsp.stat(absPath)).mtimeMs;
    } catch {
      // stat 失败（竞态被删）：mtime 视为 0，不影响数据正确性
    }
    localParsed = JSON.parse(localRaw);
  } catch (error) {
    report.mergeFailed.push({ relPath: entry.relPath, reason: `本端文件解析失败: ${errText(error)}` });
    return;
  }

  const pattern = MERGE_PATTERNS.find((p) => p.test(entry.relPath))!;
  const merged = await pattern.merge(localParsed, remoteParsed, {
    settingsBaseline: options?.settingsBaseline,
    onWarning: options?.onSettingsMergeWarning,
  });
  if (merged === null || merged === undefined) {
    report.mergeFailed.push({ relPath: entry.relPath, reason: '记录文件合并失败（结构不符合预期），待人工处理' });
    return;
  }

  if (pattern.persist) {
    await pattern.persist(absPath, merged);
  } else {
    // mtime 取 max(本端, 对端)：合并结果不旧于任一输入，避免下轮 diff 因 mtime 回退误判
    const mtimeMs = Math.max(localMtimeMs, entry.mtimeMs);
    await safeJsonWrite(absPath, merged);
    try {
      await fsp.utimes(absPath, new Date(mtimeMs), new Date(mtimeMs));
    } catch {
      // mtime 设置失败不影响数据正确性
    }
  }
  report.mergedFiles.push(entry.relPath);
  report.applied.push(entry);
}

export type OutgoingPushFn = (meta: FilePushMeta, source: Readable) => Promise<void>;

/** 推送条目：entry 为对端视角路径（折算后），localRelPath 为本端读盘路径（缺省 = entry.relPath，全局数据无折算） */
export interface OutgoingPushItem {
  entry: FileEntry;
  localRelPath?: string;
}

export interface OutgoingApplyReport {
  pushed: OutgoingPushItem[];
  skipped: SkippedEntry[];
}

export async function pushOutgoing(
  root: string,
  items: OutgoingPushItem[],
  pushFn: OutgoingPushFn,
): Promise<OutgoingApplyReport> {
  const report: OutgoingApplyReport = { pushed: [], skipped: [] };
  for (const item of items) {
    const { entry } = item;
    const readRel = item.localRelPath ?? entry.relPath;
    const abs = await resolveIncomingRelPath(root, readRel);
    if (!abs) {
      report.skipped.push({ relPath: entry.relPath, reason: unsafeReason(readRel) });
      continue;
    }
    try {
      await pushFn(toMeta(entry), createReadStream(abs));
      report.pushed.push(item);
    } catch (error) {
      report.skipped.push({
        relPath: entry.relPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

/** 把对端拉来的 gzip 流先落本端临时文件（推对端冲突副本的中转），调用方负责删除 */
export async function saveStreamToTempFile(source: Readable): Promise<string> {
  const tmpPath = path.join(tmpdir(), `dogear-conflict-${randomUUID()}`);
  await pipeline(source, createGunzip(), createWriteStream(tmpPath));
  return tmpPath;
}
