/**
 * 全局设置读写服务
 * 从 .dogear/settings.json 读写 AI 设置
 * - 开发阶段：<项目根目录>/.dogear/settings.json
 * - 打包发布后：<app.asar 同级目录>/.dogear/settings.json
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';

const { app } = electron;

// ============================================================
// 类型定义（与 types/settings.ts 保持一致，主进程独立定义）
// ============================================================

export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number;
}

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  haikuModel: string;
  sonnetModel: string;
  opusModel: string;
  apiTimeoutMs: number;
  disableNonessentialTraffic: boolean;
}

export interface AppSettings {
  ai: {
    thinking: ThinkingConfig;
    effort: 'low' | 'medium' | 'high' | 'max';
    activeProfileId: string;
    maxTurns?: number;
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk';
  };
  permissionRules?: {
    allow?: string[];
    deny?: string[];
  };
  profiles: Record<string, ModelProfile>;
}

/**
 * 检查 Profile 是否配置完整
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  return !!(
    profile.apiKey &&
    profile.baseUrl &&
    profile.haikuModel &&
    profile.sonnetModel &&
    profile.opusModel
  );
}

// ============================================================
// 默认值
// ============================================================

const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    thinking: { type: 'adaptive' },
    effort: 'high',
    activeProfileId: 'default',
    permissionMode: 'default',
  },
  profiles: {
    default: {
      id: 'default',
      name: '默认',
      apiKey: '',
      baseUrl: '',
      haikuModel: '',
      sonnetModel: '',
      opusModel: '',
      apiTimeoutMs: 3000000,
      disableNonessentialTraffic: true,
    },
  },
};

// ============================================================
// 路径函数
// ============================================================

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：app.asar 同级目录/.dogear
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getAppPath()), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getSettingsPath(): string {
  return path.join(getConfigDir(), 'settings.json');
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 深度合并两个对象
 * target 中已有的值保留，缺失的字段从 source 补充默认值
 */
function deepMerge<T extends Record<string, any>>(target: T, source: T): T {
  const result = { ...source };

  for (const key of Object.keys(target) as (keyof T)[]) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (
      targetVal !== null &&
      sourceVal !== null &&
      typeof targetVal === 'object' &&
      typeof sourceVal === 'object' &&
      !Array.isArray(targetVal) &&
      !Array.isArray(sourceVal)
    ) {
      // 递归合并嵌套对象
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      // 使用 target（用户已保存的值）覆盖 source（默认值）
      (result as Record<string, unknown>)[key as string] = targetVal;
    }
  }

  return result as T;
}

// ============================================================
// 公开接口
// ============================================================

/**
 * 读取设置
 * 文件不存在时返回默认值，已存在时与默认值深度合并（保证新增字段有默认值）
 */
export async function loadSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();

  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const saved = JSON.parse(raw) as AppSettings;
    // 与默认值深度合并，确保新增字段有默认值
    return deepMerge(saved, DEFAULT_SETTINGS);
  } catch {
    // 文件不存在或解析失败，返回默认值
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/**
 * 写入设置到 JSON 文件
 * 自动创建 .dogear 目录
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  const settingsPath = getSettingsPath();
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * 获取当前激活的 ModelProfile
 * 如果激活的 profile 不存在，回退到 default profile
 */
export function getActiveProfile(settings: AppSettings): ModelProfile {
  const { activeProfileId } = settings.ai;
  const profile = settings.profiles[activeProfileId];

  if (profile) {
    return profile;
  }

  // 回退到 default
  if (settings.profiles['default']) {
    return settings.profiles['default'];
  }

  // 兜底：返回第一个可用的 profile
  const firstKey = Object.keys(settings.profiles)[0];
  if (firstKey) {
    return settings.profiles[firstKey];
  }

  // 极端情况：profiles 为空，返回默认配置
  return DEFAULT_SETTINGS.profiles['default'];
}
