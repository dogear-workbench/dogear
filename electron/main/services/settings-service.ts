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
  BASIC_TOOL_NAMES,
  type AppSettings,
  type PiPermissionMode,
  type BasicToolPermissions,
  type BasicToolPermission,
} from './settings-types.js';

const { app } = electron;

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
 * 遍历 profiles，对 apiFormat==='pi' 且 piModels 空（缺字段或空数组）的 Profile：
 * 用 haikuModel/sonnetModel/opusModel 过滤空值 + 去重后写入 piModels。
 * 返回 true 表示发生了变化（需要落盘），false 表示无事可做。
 */
function migratePiProfiles(settings: AppSettings): boolean {
  let changed = false;
  for (const profile of Object.values(settings.profiles)) {
    if (profile.apiFormat !== 'pi') continue;
    if (profile.piModels && profile.piModels.length > 0) continue;
    const seeds = [profile.haikuModel, profile.sonnetModel, profile.opusModel]
      .filter((m): m is string => !!m && typeof m === 'string');
    const deduped = Array.from(new Set(seeds));
    profile.piModels = deduped;
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

  const staleAiFields = ['maxTurns', 'defaultSystemPrompt', 'subagentModelTier', 'excludeDynamicSections', 'promptSuggestionsEnabled', 'thinkingType', 'thinkingBudgetTokens', 'thinkingDisplay'];
  const aiObj = settings.ai as unknown as Record<string, unknown>;
  for (const field of staleAiFields) {
    if (field in aiObj) {
      delete aiObj[field];
      changed = true;
    }
  }

  if (settings.subAgent && typeof settings.subAgent === 'object' && !Array.isArray(settings.subAgent)) {
    const sub = settings.subAgent as unknown as Record<string, unknown>;
    if ('permissionMode' in sub) {
      delete sub.permissionMode;
      changed = true;
    }
  }

  return changed;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await safeJsonWrite(getSettingsPath(), settings);
}
