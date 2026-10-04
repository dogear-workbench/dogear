/**
 * 全局设置读写服务
 * 从 .dogear/settings.json 读写 AI 设置
 * - 开发阶段：<项目根目录>/.dogear/settings.json
 * - 打包发布后：<app.asar 同级目录>/.dogear/settings.json
 */
import path from 'path';
import electron from 'electron';
import { safeJsonWrite, safeJsonRead } from './safe-json.js';
import { setPaymentBlockedHosts } from './browser/site-policy.js';
import {
  DEFAULT_SETTINGS,
  deepMerge,
  createDefaultBasicToolPermissions,
  createDefaultSubAgentProfile,
  createBrowserParseSubAgentProfile,
  BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
  normalizeFailoverChain,
  normalizeBackupSettings,
  normalizeSnapshotSettings,
  BASIC_TOOL_NAMES,
  normalizeWebAiSites,
  normalizePaymentBlockedHosts,
  normalizeDisabledSyncItems,
  normalizeSyncOptions,
  normalizeUserSyncPaths,
  type AppSettings,
  type PiPermissionMode,
  type SyncOptions,
  type BasicToolPermissions,
  type BasicToolPermission,
  type ModelPricing,
} from './settings-types.js';

const { app, nativeTheme } = electron;

// 重新导出所有纯类型和纯函数，保持现有导入路径兼容
export * from './settings-types.js';

// ============================================================
// 路径函数
// ============================================================

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：AppData/Roaming/Dogear/.dogear
 */
export function getConfigDir(): string {
  // Worker 线程无 electron app，优先读注入的 DOGEAR_CONFIG_DIR
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getSettingsPath(): string {
  return path.join(getConfigDir(), 'settings.json');
}

// ============================================================
// 公开接口
// ============================================================

/**
 * 读取设置
 * 文件不存在时返回默认值，已存在时与默认值深度合并（保证新增字段有默认值）
 */
export async function loadSettings(): Promise<AppSettings> {
  const saved = await safeJsonRead<AppSettings | null>(getSettingsPath(), null);
  if (saved === null) {
    // 文件不存在或解析失败，返回默认值
    return structuredClone(DEFAULT_SETTINGS);
  }
  const merged = deepMerge(saved, DEFAULT_SETTINGS);
  const dirty = normalizeSettings(merged);
  const piMigrated = migratePiProfiles(merged);
  if (dirty || piMigrated) {
    await safeJsonWrite(getSettingsPath(), merged);
  }
  // 支付黑名单注入挂 load/save 两条链，覆盖启动、设置更新与同步合并落盘三条路径（热生效）
  setPaymentBlockedHosts(merged.paymentBlockedHosts ?? []);
  return merged;
}

/**
 * 把任意 piModels 原始值归一化为 { id, label?, contextWindow?, pricing? } 对象数组：
 * string 元素转 { id }；对象元素仅保留非空 string 的 id、非空 string 的 label、正整数的 contextWindow
 * 与三字段均为有限非负数的 pricing（整体保留或整体丢弃）；
 * 按 id 去重保首现顺序；非法元素丢弃；非数组输入返回空数组。
 */
export function normalizePiModels(raw: unknown): Array<{ id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: Array<{ id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing }> = [];
  for (const item of raw) {
    let id: string;
    let label: string | undefined;
    let contextWindow: number | undefined;
    let maxTokens: number | undefined;
    let pricing: ModelPricing | undefined;
    if (typeof item === 'string') {
      id = item;
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.id !== 'string' || obj.id === '') continue;
      id = obj.id;
      if (typeof obj.label === 'string' && obj.label !== '') label = obj.label;
      if (typeof obj.contextWindow === 'number' && Number.isInteger(obj.contextWindow) && obj.contextWindow > 0) {
        contextWindow = obj.contextWindow;
      }
      if (typeof obj.maxTokens === 'number' && Number.isInteger(obj.maxTokens) && obj.maxTokens > 0) {
        maxTokens = obj.maxTokens;
      }
      if (obj.pricing && typeof obj.pricing === 'object') {
        const p = obj.pricing as Record<string, unknown>;
        const fields = ['input', 'output', 'cacheRead'] as const;
        if (fields.every(f => typeof p[f] === 'number' && Number.isFinite(p[f]) && p[f] >= 0)) {
          pricing = { input: p.input as number, output: p.output as number, cacheRead: p.cacheRead as number };
        }
      }
    } else {
      continue;
    }
    if (id === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const entry: { id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing } = { id };
    if (label !== undefined) entry.label = label;
    if (contextWindow !== undefined) entry.contextWindow = contextWindow;
    if (maxTokens !== undefined) entry.maxTokens = maxTokens;
    if (pricing !== undefined) entry.pricing = pricing;
    result.push(entry);
  }
  return result;
}

/**
 * 遍历 profiles，把 piModels 归一化为 { id, label?, contextWindow?, pricing? } 对象数组。
 * 返回 true 表示发生了变化（需要落盘），false 表示无事可做。
 */
export function migratePiProfiles(settings: AppSettings): boolean {
  let changed = false;
  for (const profile of Object.values(settings.profiles)) {
    const p = profile as unknown as Record<string, unknown>;
    const normalized = normalizePiModels(p.piModels);
    if (JSON.stringify(normalized) !== JSON.stringify(p.piModels)) {
      p.piModels = normalized;
      changed = true;
    }
  }
  return changed;
}

function normalizePermissionMode(raw: unknown): PiPermissionMode {
  if (raw === 'default' || raw === 'autoExecute') return raw;
  return 'default';
}

function normalizeBasicToolPermissions(raw: unknown): BasicToolPermissions {
  const result = createDefaultBasicToolPermissions();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const key of BASIC_TOOL_NAMES) {
      const val = obj[key];
      if (val === 'ask' || val === 'allow') {
        result[key] = val;
      }
    }
  }
  return result;
}

export function normalizeSettings(settings: AppSettings): boolean {
  let changed = false;
  const obj = settings as unknown as Record<string, unknown>;

  if (!settings.ai || typeof settings.ai !== 'object' || Array.isArray(settings.ai)) {
    obj.ai = structuredClone(DEFAULT_SETTINGS.ai);
    changed = true;
  } else {
    const ai = settings.ai as unknown as Record<string, unknown>;
    const newMode = normalizePermissionMode(ai.permissionMode);
    if (ai.permissionMode !== newMode) {
      ai.permissionMode = newMode;
      changed = true;
    }
  }

  const newPerms = normalizeBasicToolPermissions(obj.basicToolPermissions);
  const currentPerms = obj.basicToolPermissions;
  if (
    !currentPerms ||
    typeof currentPerms !== 'object' ||
    Array.isArray(currentPerms) ||
    JSON.stringify(currentPerms) !== JSON.stringify(newPerms)
  ) {
    obj.basicToolPermissions = newPerms;
    changed = true;
  }

  if (obj.appearance !== undefined && (typeof obj.appearance !== 'object' || Array.isArray(obj.appearance))) {
    obj.appearance = { theme: 'light' };
    changed = true;
  } else if (obj.appearance && typeof obj.appearance === 'object') {
    const ap = obj.appearance as Record<string, unknown>;
    if (ap.theme !== 'light' && ap.theme !== 'dark' && ap.theme !== 'system') {
      ap.theme = 'light';
      changed = true;
    }
  }

  if (obj.browserSearchEngine !== 'auto' && obj.browserSearchEngine !== 'google' && obj.browserSearchEngine !== 'bing') {
    obj.browserSearchEngine = 'auto';
    changed = true;
  }
  if (obj.browserProxyServer !== undefined && typeof obj.browserProxyServer !== 'string') {
    delete obj.browserProxyServer;
    changed = true;
  }
  if (obj.webMcpApiKey !== undefined && typeof obj.webMcpApiKey !== 'string') {
    delete obj.webMcpApiKey;
    changed = true;
  }

  const subAgent = settings.subAgent as unknown as Record<string, unknown> | undefined;
  if (subAgent && typeof subAgent === 'object' && !Array.isArray(subAgent)) {
    if (Array.isArray(subAgent.profiles)) {
      for (const profile of subAgent.profiles) {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
        const p = profile as Record<string, unknown>;
        if (!Array.isArray(p.enabledBasicTools)) {
          p.enabledBasicTools = ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'];
          changed = true;
        }
        if (!p.enabledAbilities || typeof p.enabledAbilities !== 'object' || Array.isArray(p.enabledAbilities)) {
          p.enabledAbilities = {};
          changed = true;
        }
        if (p.enabledAbilities && typeof p.enabledAbilities === 'object' && !Array.isArray(p.enabledAbilities)) {
          const ab = p.enabledAbilities as Record<string, unknown>;
          if ('browser' in ab && typeof ab.browser !== 'boolean') {
            delete ab.browser;
            changed = true;
          }
          if ('extension' in ab && typeof ab.extension !== 'boolean') {
            delete ab.extension;
            changed = true;
          }
          if ('web' in ab && typeof ab.web !== 'boolean') {
            delete ab.web;
            changed = true;
          }
          // 拆包迁移：存量 browser 生效的 Profile 把 browser-exploration 补进 skills 细选（方法论包与通道解耦后走通用细选）；
          // 只在 skills 键整体缺失时写入，清理过数组视为显式意愿不回填
          if (ab.browser === true && !('skills' in ab)) {
            ab.skills = ['browser-exploration'];
            changed = true;
          }
          // 内置 Profile 升级新增能力键时，旧数据只补缺失键；显式 false 是用户关闭，不覆盖
          if (p.id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID) {
            const builtinAb = createBrowserParseSubAgentProfile().enabledAbilities as Record<string, unknown>;
            for (const key of Object.keys(builtinAb)) {
              if (!(key in ab)) {
                ab[key] = builtinAb[key];
                changed = true;
              }
            }
          }
          if (p.id === 'default') {
            const builtinAb = createDefaultSubAgentProfile().enabledAbilities as Record<string, unknown>;
            for (const key of Object.keys(builtinAb)) {
              if (!(key in ab)) {
                ab[key] = builtinAb[key];
                changed = true;
              }
            }
          }
        }
      }
      if (subAgent.profiles.length === 0) {
        subAgent.profiles = [createDefaultSubAgentProfile(), createBrowserParseSubAgentProfile()];
        changed = true;
      }
      const existingProfiles = subAgent.profiles as unknown[];
      if (!existingProfiles.some((p) => p !== null && typeof p === 'object' && (p as { id?: unknown }).id === BROWSER_PARSE_SUB_AGENT_PROFILE_ID)) {
        existingProfiles.push(createBrowserParseSubAgentProfile());
        changed = true;
      }
    } else {
      subAgent.profiles = [createDefaultSubAgentProfile(), createBrowserParseSubAgentProfile()];
      changed = true;
    }
  } else {
    obj.subAgent = { profiles: [createDefaultSubAgentProfile(), createBrowserParseSubAgentProfile()] };
    changed = true;
  }

  const normalizedSites = normalizeWebAiSites(obj.webAiSites);
  if (JSON.stringify(normalizedSites) !== JSON.stringify(obj.webAiSites)) {
    obj.webAiSites = normalizedSites;
    changed = true;
  }

  if (obj.paymentBlockedHosts !== undefined) {
    const normalizedHosts = normalizePaymentBlockedHosts(obj.paymentBlockedHosts);
    if (JSON.stringify(normalizedHosts) !== JSON.stringify(obj.paymentBlockedHosts)) {
      if (normalizedHosts.length === 0) delete obj.paymentBlockedHosts;
      else obj.paymentBlockedHosts = normalizedHosts;
      changed = true;
    }
  }

  const newBackup = normalizeBackupSettings(obj.backup);
  if (JSON.stringify(newBackup) !== JSON.stringify(settings.backup)) {
    obj.backup = newBackup;
    changed = true;
  }

  const newSnapshot = normalizeSnapshotSettings(obj.snapshot);
  if (JSON.stringify(newSnapshot) !== JSON.stringify(settings.snapshot)) {
    obj.snapshot = newSnapshot;
    changed = true;
  }

  const newFailover = normalizeFailoverChain(settings.profiles, settings.failover);
  if (JSON.stringify(newFailover) !== JSON.stringify(settings.failover)) {
    obj.failover = newFailover;
    changed = true;
  }

  const newSyncOptions = normalizeSyncOptions(settings.syncOptions);
  if (JSON.stringify(newSyncOptions) !== JSON.stringify(settings.syncOptions)) {
    obj.syncOptions = newSyncOptions;
    changed = true;
  }

  return changed;
}

/**
 * disabledSyncItems 集合相等判断：顺序无关（语义是集合，重排不算变化、不 bump rev）
 */
function disabledSyncItemsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((item) => sb.has(item));
}

/**
 * userSyncPaths 相等判断：键序与条目序都无关（语义是 per-workspace 集合），归一后比较
 */
function userSyncPathsEqual(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined,
): boolean {
  const norm = (m: Record<string, string[]> | undefined) =>
    Object.keys(m ?? {})
      .sort()
      .map((k) => `${k}=${[...(m ?? {})[k]].sort().join(',')}`)
      .join('|');
  return norm(a) === norm(b);
}

/**
 * 应用 syncOptions 部分更新并维护 syncOptionsRev（设置写入口统一走这里，tipc setSyncOptions 调用）：
 * 范围字段（syncStocksData/syncFeishu/disabledSyncItems/syncConflictCopies/syncShadowGit/userSyncPaths，
 * 即 merge rev 组全集）任一相对旧值实际变化 → rev = max(old ?? 0, 0) + 1；仅改 deviceName / pairedDevices /
 * removeDeviceId 不动 rev，传了相同值也不动（幂等）。disabledSyncItems/userSyncPaths 先过归一化清洗再比较，
 * 非法条目不触发 rev。返回新对象不落盘，调用方自行 saveSettings。
 */
export function applySyncOptionsPatch(
  current: SyncOptions,
  patch: Partial<SyncOptions> & { removeDeviceId?: string },
): SyncOptions {
  const next: SyncOptions = { ...current };
  if (patch.deviceName !== undefined) next.deviceName = patch.deviceName;
  if (patch.syncStocksData !== undefined) next.syncStocksData = patch.syncStocksData === true;
  if (patch.syncFeishu !== undefined) next.syncFeishu = patch.syncFeishu === true;
  if (patch.disabledSyncItems !== undefined) next.disabledSyncItems = normalizeDisabledSyncItems(patch.disabledSyncItems);
  if (patch.syncConflictCopies !== undefined) next.syncConflictCopies = patch.syncConflictCopies === true;
  if (patch.syncShadowGit !== undefined) next.syncShadowGit = patch.syncShadowGit === true;
  if (patch.userSyncPaths !== undefined) next.userSyncPaths = normalizeUserSyncPaths(patch.userSyncPaths);
  if (patch.removeDeviceId) next.pairedDevices = next.pairedDevices.filter((d) => d.deviceId !== patch.removeDeviceId);

  const scopeChanged =
    (patch.syncStocksData !== undefined && next.syncStocksData !== current.syncStocksData) ||
    (patch.syncFeishu !== undefined && next.syncFeishu !== current.syncFeishu) ||
    (patch.syncConflictCopies !== undefined && (next.syncConflictCopies === true) !== (current.syncConflictCopies === true)) ||
    (patch.syncShadowGit !== undefined && (next.syncShadowGit === true) !== (current.syncShadowGit === true)) ||
    (patch.disabledSyncItems !== undefined &&
      !disabledSyncItemsEqual(next.disabledSyncItems ?? [], current.disabledSyncItems ?? [])) ||
    (patch.userSyncPaths !== undefined && !userSyncPathsEqual(next.userSyncPaths, current.userSyncPaths));
  next.syncOptionsRev = (current.syncOptionsRev ?? 0) + (scopeChanged ? 1 : 0);
  return next;
}

/**
 * 把外观主题同步到 Electron nativeTheme（跟随系统 + 原生标题栏深浅）
 * themeSource 可在 app ready 前设置
 */
export function applyThemeSource(theme: unknown): void {
  const t = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'light';
  if (nativeTheme && nativeTheme.themeSource !== t) nativeTheme.themeSource = t;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await safeJsonWrite(getSettingsPath(), settings);
  applyThemeSource(settings.appearance?.theme);
  setPaymentBlockedHosts(settings.paymentBlockedHosts ?? []);
}
