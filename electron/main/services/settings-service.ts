/**
 * 全局设置读写服务
 * 从 .dogear/settings.json 读写 AI 设置
 * - 开发阶段：<项目根目录>/.dogear/settings.json
 * - 打包发布后：<app.asar 同级目录>/.dogear/settings.json
 */
import path from 'path';
import electron from 'electron';
import { safeJsonWrite, safeJsonRead } from './safe-json.js';
import {
  DEFAULT_SETTINGS,
  deepMerge,
  createDefaultBasicToolPermissions,
  createDefaultSubAgentProfile,
  createBrowserParseSubAgentProfile,
  BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
  normalizeFailoverChain,
  BASIC_TOOL_NAMES,
  type AppSettings,
  type PiPermissionMode,
  type BasicToolPermissions,
  type BasicToolPermission,
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
  return merged;
}

/**
 * 把任意 piModels 原始值归一化为 { id, label?, contextWindow? } 对象数组：
 * string 元素转 { id }；对象元素仅保留非空 string 的 id、非空 string 的 label 与正整数的 contextWindow；
 * 按 id 去重保首现顺序；非法元素丢弃；非数组输入返回空数组。
 */
export function normalizePiModels(raw: unknown): Array<{ id: string; label?: string; contextWindow?: number }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: Array<{ id: string; label?: string; contextWindow?: number }> = [];
  for (const item of raw) {
    let id: string;
    let label: string | undefined;
    let contextWindow: number | undefined;
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
    } else {
      continue;
    }
    if (id === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const entry: { id: string; label?: string; contextWindow?: number } = { id };
    if (label !== undefined) entry.label = label;
    if (contextWindow !== undefined) entry.contextWindow = contextWindow;
    result.push(entry);
  }
  return result;
}

export const LEGACY_MODEL_TIERS = new Set(['haiku', 'sonnet', 'opus']);

/**
 * 遍历 profiles，无条件 pi 化：piModels 非数组或为空时用 haikuModel/sonnetModel/opusModel
 * 过滤空值后填入，再统一迁移为 { id, label? } 对象数组，然后删除旧 SDK 字段
 * （apiFormat/三档模型/disableNonessentialTraffic/autoCompactWindow）；
 * 随后把 settings 内所有 ModelSelection 残留的旧三档 tier（haiku/sonnet/opus）映射为
 * piModels 里的真实模型 id（子串匹配），无匹配时置 null 回退默认选择。
 * 返回 true 表示发生了变化（需要落盘），false 表示无事可做。
 */
export function migratePiProfiles(settings: AppSettings): boolean {
  let changed = false;
  for (const profile of Object.values(settings.profiles)) {
    const p = profile as unknown as Record<string, unknown>;
    if (!Array.isArray(p.piModels) || p.piModels.length === 0) {
      const seeds = [p.haikuModel, p.sonnetModel, p.opusModel]
        .filter((m): m is string => !!m && typeof m === 'string');
      // 种子全空且 piModels 本就是合法空数组时不写入，避免每次启动都无意义落盘
      if (seeds.length > 0 || !Array.isArray(p.piModels)) {
        p.piModels = seeds;
        changed = true;
      }
    }
    const normalized = normalizePiModels(p.piModels);
    if (JSON.stringify(normalized) !== JSON.stringify(p.piModels)) {
      p.piModels = normalized;
      changed = true;
    }
    for (const field of ['apiFormat', 'haikuModel', 'sonnetModel', 'opusModel', 'disableNonessentialTraffic', 'autoCompactWindow']) {
      if (field in p) {
        delete p[field];
        changed = true;
      }
    }
  }

  for (const key of ['defaultModelSelection', 'digestModelSelection', 'reviewModelSelection', 'categorizeModelSelection', 'parseModelSelection'] as const) {
    const sel = settings.ai[key];
    if (!sel || !LEGACY_MODEL_TIERS.has(sel.tier)) continue;
    const models = settings.profiles[sel.profileId]?.piModels ?? [];
    const matched = models.find(m => m.id.toLowerCase().includes(sel.tier));
    settings.ai[key] = matched ? { ...sel, tier: matched.id } : null;
    changed = true;
  }
  for (const subProfile of settings.subAgent?.profiles ?? []) {
    const sel = subProfile.modelSelection;
    if (!sel || !LEGACY_MODEL_TIERS.has(sel.tier)) continue;
    const models = settings.profiles[sel.profileId]?.piModels ?? [];
    const matched = models.find(m => m.id.toLowerCase().includes(sel.tier));
    subProfile.modelSelection = matched ? { ...sel, tier: matched.id } : null;
    changed = true;
  }
  return changed;
}


const OLD_AUTO_MODES = new Set(['bypassPermissions', 'dontAsk', 'auto', 'acceptEdits']);

function normalizePermissionMode(raw: unknown): PiPermissionMode {
  if (raw === 'default' || raw === 'autoExecute') return raw;
  if (typeof raw === 'string' && OLD_AUTO_MODES.has(raw)) return 'autoExecute';
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

  if ('permissionRules' in settings) {
    delete obj.permissionRules;
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

  const staleAiFields = ['maxTurns', 'defaultSystemPrompt', 'subagentModelTier', 'excludeDynamicSections', 'promptSuggestionsEnabled', 'thinkingType', 'thinkingBudgetTokens', 'thinkingDisplay'];
  const aiObj = settings.ai as unknown as Record<string, unknown>;
  for (const field of staleAiFields) {
    if (field in aiObj) {
      delete aiObj[field];
      changed = true;
    }
  }

  const subAgent = settings.subAgent as unknown as Record<string, unknown> | undefined;
  if (subAgent && typeof subAgent === 'object' && !Array.isArray(subAgent)) {
    if ('permissionMode' in subAgent) {
      delete subAgent.permissionMode;
      changed = true;
    }
    for (const staleField of ['cachePolicy', 'loadCoreProfile', 'loadSkills', 'loadArticleParse']) {
      if (staleField in subAgent) {
        delete subAgent[staleField];
        changed = true;
      }
    }
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
          if ('groupFiles' in ab) {
            delete ab.groupFiles;
            changed = true;
          }
          if ('browser' in ab && typeof ab.browser !== 'boolean') {
            delete ab.browser;
            changed = true;
          }
          if ('extension' in ab && typeof ab.extension !== 'boolean') {
            delete ab.extension;
            changed = true;
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

  const newFailover = normalizeFailoverChain(settings.profiles, settings.failover);
  if (JSON.stringify(newFailover) !== JSON.stringify(settings.failover)) {
    obj.failover = newFailover;
    changed = true;
  }

  return changed;
}

/**
 * 把外观主题同步到 Electron nativeTheme（跟随系统 + 原生标题栏深浅）
 * themeSource 可在 app ready 前设置
 */
export function applyThemeSource(theme: unknown): void {
  const t = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'light';
  if (nativeTheme.themeSource !== t) nativeTheme.themeSource = t;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await safeJsonWrite(getSettingsPath(), settings);
  applyThemeSource(settings.appearance?.theme);
}
