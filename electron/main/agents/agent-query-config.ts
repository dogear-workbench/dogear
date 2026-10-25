/**
 * Worker 线程安全的设置读取入口
 *
 * 此文件无 electron 依赖，可在 Worker 线程中安全导入。
 * pi 后台任务（PARSE_ARTICLE）共用此入口读取 appSettings，
 * 再把结果喂给 pi/provider.ts 的 resolvePiModel。
 */

import path from 'path';
import { safeJsonRead } from '../services/safe-json.js';
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  deepMerge,
} from '../services/settings-types.js';

/**
 * 从指定 configDir 读取 settings.json 并合并默认值
 * （不依赖 electron.app，可在 Worker 线程中调用）
 */
export async function loadSettingsFromDir(configDir: string): Promise<AppSettings> {
  const settingsPath = path.join(configDir, 'settings.json');
  const saved = await safeJsonRead<AppSettings | null>(settingsPath, null);
  if (saved === null) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  return deepMerge(saved, DEFAULT_SETTINGS);
}
