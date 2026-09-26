import path from 'path';
import { getConfigDir } from '../../services/settings-service.js';

/**
 * 禁写区清单（相对 configDir 顶层），原则=有专用写工具或 app 独占高频写：
 * - 专用工具域：notes/、memory/（dogear__ 工具）、tasks.json/plans.json（任务系统）、stocks/（行情/自选股服务）
 * - app 独占高频写：usage/、logs/、run-history/、tmp/、workspaces/（含会话 JSONL 与各区 config）、conversations/
 */
const WRITE_EXCLUDED_TOP_LEVEL = [
  'notes',
  'memory',
  'tasks.json',
  'plans.json',
  'usage',
  'logs',
  'run-history',
  'tmp',
  'workspaces',
  'conversations',
  'stocks',
];

export function buildWriteExcludedPaths(): string[] {
  const configDir = getConfigDir();
  return WRITE_EXCLUDED_TOP_LEVEL.map((p) => path.join(configDir, p));
}

function normalizeForCompare(p: string): string {
  return path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
}

/** 大小写不敏感前缀包含去重：候选根与已有根互为对方子路径（含相等）时跳过，保留先出现的父路径 */
export function dedupeBasePaths(paths: string[]): string[] {
  const result: string[] = [];
  for (const p of paths) {
    const normalized = normalizeForCompare(p);
    const contained = result.some((kept) => {
      const k = normalizeForCompare(kept);
      return normalized === k || normalized.startsWith(k + path.sep) || k.startsWith(normalized + path.sep);
    });
    if (!contained) result.push(p);
  }
  return result;
}

/** 会话文件边界的唯一计算来源：[workspacePath, ...additionalPaths, configDir] 去重 */
export function computeBasePaths(workspacePath: string, additionalPaths: string[]): string[] {
  return dedupeBasePaths([workspacePath, ...additionalPaths, getConfigDir()].filter(Boolean));
}
