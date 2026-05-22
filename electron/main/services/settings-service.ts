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
function getConfigDir(): string {
  if (app.isPackaged) {
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
  // 与默认值深度合并，确保新增字段有默认值
  return deepMerge(saved, DEFAULT_SETTINGS);
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
      allow: Array.from(existing),
      deny: current.permissionRules?.deny || [],
    },
  });
}
