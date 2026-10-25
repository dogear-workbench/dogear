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
  createBuiltinSubAgentProfiles,
  BUILTIN_SUB_AGENT_PROFILE_IDS,
  normalizeFailoverChain,
  normalizeBackupSettings,
  normalizeSnapshotSettings,
  BASIC_TOOL_NAMES,
  normalizePaymentBlockedHosts,
  normalizeTaskBrowser,
  normalizeDisabledSyncItems,
  normalizeSyncOptions,
  normalizeUserSyncPaths,
  type AppSettings,
  type PiPermissionMode,
  type SyncOptions,
  type BasicToolPermissions,
  type BasicToolPermission,
  type ModelPricing,
  type SubAgentProfile,
  type EffortLevel,
  EFFORT_LEVELS,
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
 * 把任意 piModels 原始值归一化为 { id, label?, contextWindow?, maxTokens?, pricing?, supportsVision?, effort? } 对象数组：
 * string 元素转 { id }；对象元素仅保留非空 string 的 id、非空 string 的 label、正整数的 contextWindow、正整数 maxTokens、
 * 三字段均为有限非负数的 pricing（整体保留或整体丢弃）、布尔 true 的 supportsVision（显式 false 丢弃，等价未标记）
 * 与合法 EffortLevel 字面量的 effort；
 * 按 id 去重保首现顺序；非法元素丢弃；非数组输入返回空数组。
 */
export function normalizePiModels(raw: unknown): Array<{ id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing; supportsVision?: boolean; effort?: EffortLevel | null }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: Array<{ id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing; supportsVision?: boolean; effort?: EffortLevel | null }> = [];
  for (const item of raw) {
    let id: string;
    let label: string | undefined;
    let contextWindow: number | undefined;
    let maxTokens: number | undefined;
    let pricing: ModelPricing | undefined;
    let supportsVision: boolean | undefined;
    let effort: EffortLevel | undefined;
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
      if (obj.supportsVision === true) supportsVision = true;
      if (typeof obj.effort === 'string' && (EFFORT_LEVELS as readonly string[]).includes(obj.effort)) {
        effort = obj.effort as EffortLevel;
      }
    } else {
      continue;
    }
    if (id === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const entry: { id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing; supportsVision?: boolean; effort?: EffortLevel | null } = { id };
    if (label !== undefined) entry.label = label;
    if (contextWindow !== undefined) entry.contextWindow = contextWindow;
    if (maxTokens !== undefined) entry.maxTokens = maxTokens;
    if (pricing !== undefined) entry.pricing = pricing;
    if (supportsVision !== undefined) entry.supportsVision = supportsVision;
    if (effort !== undefined) entry.effort = effort;
    result.push(entry);
  }
  return result;
}

/**
 * 遍历 profiles，把 piModels 归一化为 { id, label?, contextWindow?, maxTokens?, pricing?, supportsVision?, effort? } 对象数组。
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

/** 收编映射：目标内置 slug 缺席时，同名自建条目（首个命中）改挂内置 slug，配置字段全保留；文案随后由内置接管逻辑刷成模板版 */
const SUB_AGENT_ADOPT_TARGETS: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: 'explore', name: '探索' },
  { slug: 'stock', name: '股票' },
];

function normalizeSubAgentProfiles(subAgent: Record<string, unknown>): boolean {
  let changed = false;
  if (!Array.isArray(subAgent.profiles)) {
    subAgent.profiles = createBuiltinSubAgentProfiles();
    return true;
  }
  // deepMerge 在 subAgent 对象存在但缺 profiles 键时会泄漏 DEFAULT_SETTINGS 的数组引用，补齐 push 前先隔离，防污染全局常量
  if (subAgent.profiles === DEFAULT_SETTINGS.subAgent.profiles) {
    subAgent.profiles = structuredClone(subAgent.profiles);
  }
  const profiles = subAgent.profiles as unknown[];

  for (const { slug, name } of SUB_AGENT_ADOPT_TARGETS) {
    if (profiles.some((p) => p !== null && typeof p === 'object' && (p as { id?: unknown }).id === slug)) continue;
    const hit = profiles.find(
      (p) =>
        p !== null &&
        typeof p === 'object' &&
        (p as { name?: unknown }).name === name &&
        !BUILTIN_SUB_AGENT_PROFILE_IDS.includes((p as { id?: unknown }).id as string),
    );
    if (hit) {
      (hit as { id: string }).id = slug;
      changed = true;
    }
  }

  const builtinTemplates = new Map<string, SubAgentProfile>(
    createBuiltinSubAgentProfiles().map((t) => [t.id, t]),
  );

  for (const profile of profiles) {
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
      // 内嵌浏览器下线迁移：browser 子开关键一律清除（注册表侧已无此包，残留下线 key 静默忽略兑底）
      if ('browser' in ab) {
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
      // 方法论 skill 随包下线：skills 细选去 browser-exploration，清空则删键
      if (Array.isArray(ab.skills)) {
        const filtered = (ab.skills as unknown[]).filter((s) => s !== 'browser-exploration');
        if (filtered.length !== ab.skills.length) {
          if (filtered.length === 0) delete ab.skills;
          else ab.skills = filtered;
          changed = true;
        }
      }
    }

    // 内置条目：文案（name/description）以代码模板为单一真源无条件接管；能力域只补缺失键，显式 false 是用户/产品收敛结果不覆盖；
    // enabled/modelSelection/timeoutMinutes 等配置字段用户自治不动
    const builtin = builtinTemplates.get(p.id as string);
    if (builtin) {
      if (p.name !== builtin.name) {
        p.name = builtin.name;
        changed = true;
      }
      if (p.description !== builtin.description) {
        p.description = builtin.description;
        changed = true;
      }
      const ab = p.enabledAbilities as Record<string, unknown>;
      for (const [key, value] of Object.entries(builtin.enabledAbilities)) {
        if (!(key in ab)) {
          ab[key] = value;
          changed = true;
        }
      }
    }
  }

  for (const template of builtinTemplates.values()) {
    if (!profiles.some((p) => p !== null && typeof p === 'object' && (p as { id?: unknown }).id === template.id)) {
      profiles.push(template);
      changed = true;
    }
  }

  return changed;
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
    const newUnattended = ai.unattended === true;
    if (ai.unattended !== newUnattended) {
      ai.unattended = newUnattended;
      changed = true;
    }
    if ('stateModelSelection' in ai) {
      delete ai.stateModelSelection;
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
  if (obj.taskBrowser !== undefined && !normalizeTaskBrowser(obj.taskBrowser)) {
    delete obj.taskBrowser;
    changed = true;
  }
  if (obj.webMcpApiKey !== undefined && typeof obj.webMcpApiKey !== 'string') {
    delete obj.webMcpApiKey;
    changed = true;
  }

  const subAgent = settings.subAgent as unknown as Record<string, unknown> | undefined;
  if (subAgent && typeof subAgent === 'object' && !Array.isArray(subAgent)) {
    if (normalizeSubAgentProfiles(subAgent)) changed = true;
  } else {
    obj.subAgent = { profiles: createBuiltinSubAgentProfiles() };
    changed = true;
  }

  // 网页 AI 下架残留：字段已删，存量 settings.json 首次 load 清掉后落盘
  if ('webAiSites' in obj) {
    delete obj.webAiSites;
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
