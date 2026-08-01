/**
 * 全局设置读写服务
 * 从 .dogear/settings.json 读写 AI 设置
 * - 开发阶段：<项目根目录>/.dogear/settings.json
 * - 打包发布后：<app.asar 同级目录>/.dogear/settings.json
 */
import path from 'path';
import electron from 'electron';
import { safeJsonWrite, safeJsonRead } from './safe-json.js';
import { DEFAULT_SETTINGS, deepMerge, type AppSettings } from './settings-types.js';

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
  // 一次性存量迁移：已经是 pi 格式但还没 piModels 的 Profile，用旧三档字段种初始清单。
  // 幂等——piModels 已非空就跳过；迁移后落盘，下次启动直接命中。
  const migrated = migratePiProfiles(merged);
  if (migrated) {
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

/**
 * 写入设置到 JSON 文件
 * 自动创建 .dogear 目录
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  await safeJsonWrite(getSettingsPath(), settings);
}

/**
 * 追加规则到 permissionRules.allow，自动去重。
 * 用于权限请求"始终允许"按钮的持久化。
 */
export async function appendPermissionAllowRules(rules: string[]): Promise<void> {
  if (!rules.length) return;
  const current = await loadSettings();
  const existing = new Set(current.permissionRules?.allow || []);
  const before = existing.size;
  for (const r of rules) existing.add(r);
  if (existing.size === before) return; // 全部已存在，跳过写盘
  await saveSettings({
    ...current,
    permissionRules: {
      ...current.permissionRules,
      allow: Array.from(existing),
    },
  });
}
