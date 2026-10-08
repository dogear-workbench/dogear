import { BASIC_TOOL_NAMES, type BasicToolName, type BasicToolPermission, type BasicToolPermissions, createDefaultBasicToolPermissions } from '../../services/settings-types.js';

export { BASIC_TOOL_NAMES, createDefaultBasicToolPermissions };
export type { BasicToolName, BasicToolPermission, BasicToolPermissions };

const BASIC_TOOL_NAME_SET: ReadonlySet<string> = new Set(BASIC_TOOL_NAMES);

export function isBasicToolName(name: string): name is BasicToolName {
  return BASIC_TOOL_NAME_SET.has(name);
}

export function getBasicToolPermission(
  map: BasicToolPermissions,
  name: string,
): BasicToolPermission | undefined {
  return isBasicToolName(name) ? map[name] : undefined;
}

export type ToolPermissionDecision = 'allow' | 'ask';

// 浏览器交互三工具：default 模式逐次确认，工具包启用不覆盖；autoExecute 模式在函数入口已全放行
const BROWSER_INTERACTIVE_TOOLS: ReadonlySet<string> = new Set([
  'dogear__browser__readArticle',
  'dogear__browser__click',
  'dogear__browser__fill',
]);

// 破坏性 git 操作：整仓 revert 会产生反向提交改写工作区，与浏览器交互工具同语义（工具包启用不覆盖）
const PERMISSION_ASK_TOOLS: ReadonlySet<string> = new Set([...BROWSER_INTERACTIVE_TOOLS, 'dogear__GitRevert']);

export function decideToolPermission(
  toolName: string,
  mode: 'default' | 'autoExecute',
  toolPackMap: ReadonlyMap<string, string>,
  sessionAllowedTools: ReadonlySet<string>,
  basicToolPermissions: BasicToolPermissions,
): ToolPermissionDecision {
  if (mode === 'autoExecute') return 'allow';
  if (PERMISSION_ASK_TOOLS.has(toolName)) return 'ask';
  if (toolPackMap.has(toolName)) return 'allow';
  if (isBasicToolName(toolName)) {
    if (sessionAllowedTools.has(toolName) || basicToolPermissions[toolName] === 'allow') {
      return 'allow';
    }
  }
  return 'ask';
}
