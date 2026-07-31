/**
 * pi 会话权限规则匹配（工具粒度）。
 *
 * 与 SDK 侧共享 settings.json 的 `permissionRules.allow` 存储字段（同一个
 * appendPermissionAllowRules 写入口），但两边互不解析对方的规则字符串格式：
 * SDK 用 `ToolName(ruleContent)` 精细到命令模式，pi 这里只做裸工具名精确匹配
 * （"允许这个工具以后都不用问"，不做 Bash 命令级别的 glob）。两种格式共存于
 * 同一数组不会互相误判——SDK 规则带括号，pi 规则是纯工具名，字符串精确匹配不会碰撞。
 */

/** 无需权限确认即可执行的只读工具，对齐 SDK 侧 query-based-session.ts 默认 allowedTools 白名单口径 */
export const PERMISSION_EXEMPT_TOOLS: ReadonlySet<string> = new Set(['read', 'Glob', 'Grep']);

export function isPermissionExempt(toolName: string): boolean {
  return PERMISSION_EXEMPT_TOOLS.has(toolName);
}

/** 检查工具名是否命中已持久化的 permissionRules.allow 规则（裸工具名精确匹配） */
export function isToolPreapproved(allowRules: string[] | undefined, toolName: string): boolean {
  return !!allowRules?.includes(toolName);
}
