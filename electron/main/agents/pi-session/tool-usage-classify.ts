import type { PiSessionConfig } from './pi-session-config.js';
import type { ToolUsageSessionType } from '../../services/tool-usage/tool-usage-service.js';

const BASIC_PACK_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'read_terminal', 'kill_terminal']);
const SEARCH_PACK_TOOLS = new Set(['Glob', 'Grep']);
const SPECIAL_PACK_TOOLS: Record<string, string> = { tool_search: 'tool-search', Skill: 'skill' };

/** 工具 → 能力包归类：toolPackMap 反查优先（动态注册包），其余落内置归类，未收录返回 null */
export function classifyToolPack(toolName: string, packMap: Map<string, string>): string | null {
  return packMap.get(toolName)
    ?? (BASIC_PACK_TOOLS.has(toolName) ? 'basic' : null)
    ?? (SEARCH_PACK_TOOLS.has(toolName) ? 'search' : null)
    ?? SPECIAL_PACK_TOOLS[toolName]
    ?? null;
}

/** 记录维度会话类型：无人值守执行 > 定时任务 > 会话角色 */
export function resolveToolUsageSessionType(config: PiSessionConfig): ToolUsageSessionType {
  if (config.executor) return 'executor';
  if (config.schedulerTask) return 'scheduler';
  return config.role;
}
