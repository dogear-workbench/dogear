/**
 * pi 会话权限规则匹配（工具粒度）。
 *
 * 与 SDK 侧共享 settings.json 的 `permissionRules.allow` 存储字段（同一个
 * appendPermissionAllowRules 写入口），但两边互不解析对方的规则字符串格式：
 * SDK 用 `ToolName(ruleContent)` 精细到命令模式，pi 这里只做裸工具名精确匹配
 * （"允许这个工具以后都不用问"，不做 Bash 命令级别的 glob）。两种格式共存于
 * 同一数组不会互相误判——SDK 规则带括号，pi 规则是纯工具名，字符串精确匹配不会碰撞。
 */

/** 无需权限确认即可执行的只读工具，对齐旧 SDK 主会话运行时的默认 allowedTools 白名单口径 */
export const PERMISSION_EXEMPT_TOOLS: ReadonlySet<string> = new Set(['read', 'Glob', 'Grep']);

export function isPermissionExempt(toolName: string): boolean {
  return PERMISSION_EXEMPT_TOOLS.has(toolName);
}

/** 检查工具名是否命中已持久化的 permissionRules.allow 规则（裸工具名精确匹配） */
export function isToolPreapproved(allowRules: string[] | undefined, toolName: string): boolean {
  return !!allowRules?.includes(toolName);
}

export function isToolDenied(denyRules: string[] | undefined, toolName: string): boolean {
  return !!denyRules?.includes(toolName);
}

export function isToolForcedAsk(askRules: string[] | undefined, toolName: string): boolean {
  return !!askRules?.includes(toolName);
}

const FILESYSTEM_BASH_COMMAND = /(?:^|[;&|]\s*)(?:mkdir|touch|rm|mv|cp|sed)\b/;

export function isAutoAllowedEditTool(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === 'write' || toolName === 'edit') return true;
  return toolName === 'bash' && typeof input.command === 'string' && FILESYSTEM_BASH_COMMAND.test(input.command);
}

/**
 * 常驻放行工具包：只要挂了就不弹确认，不受 enabledToolPacks 开关控制
 * （dogear-group / dogear-delegation / dogear-reference 按 conversation.groupId 存在挂载，dogear-memory-review 按 workspacePath 齐全挂载）。
 */
export const ALWAYS_ALLOWED_TOOL_PACKS: ReadonlySet<string> = new Set([
  'dogear-group',
  'dogear-delegation',
  'dogear-reference',
  'dogear-memory-review',
]);

/**
 * 工具包粒度批量免确认判定，对齐旧 SDK `allowedTools: mcp__<server>__*` 通配符体验：
 * 给定工具名和 PiSession 组装 toolDefs 时构建的「工具名 → 工具包标识」映射表，
 * 若该工具所属工具包在 enabledToolPacks 里，或属于 ALWAYS_ALLOWED_TOOL_PACKS 常驻放行类别，
 * 则整包免确认（不区分包内读写工具，与旧 SDK 侧口径一致）。
 */
export function isToolInEnabledPack(
  toolName: string,
  toolPackMap: ReadonlyMap<string, string>,
  enabledToolPacks: readonly string[],
): boolean {
  const pack = toolPackMap.get(toolName);
  if (!pack) return false;
  return ALWAYS_ALLOWED_TOOL_PACKS.has(pack) || enabledToolPacks.includes(pack);
}
