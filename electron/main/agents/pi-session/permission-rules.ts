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

export function decideToolPermission(
  toolName: string,
  mode: 'default' | 'autoExecute',
  toolPackMap: ReadonlyMap<string, string>,
  sessionAllowedTools: ReadonlySet<string>,
  basicToolPermissions: BasicToolPermissions,
): ToolPermissionDecision {
  if (mode === 'autoExecute') return 'allow';
  if (toolPackMap.has(toolName)) return 'allow';
  if (isBasicToolName(toolName)) {
    if (sessionAllowedTools.has(toolName) || basicToolPermissions[toolName] === 'allow') {
      return 'allow';
    }
  }
  return 'ask';
}
