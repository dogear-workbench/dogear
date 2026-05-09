/**
 * 工具包导览生成器
 *
 * 注入到 system prompt append 的最后一段，告诉 Agent 当前会话能用到哪些工具类目。
 *
 * 背景：SDK 默认开启 Tool Search（ENABLE_TOOL_SEARCH=always on），MCP 工具的完整 schema
 * 不会进上下文，只有"工具目录摘要"可见。这段导览帮 Agent 在判断"我要不要 search 工具"
 * 时有更明确的方向感，提升命中率。
 *
 * 详见 docs/plans/2026-05/2026-05-09/skill-tool-search-migration.md
 */

import { OPTIONAL_TOOL_PACKS } from '../services/tool-packs.js';

/**
 * 生成工具导览文本，无可用工具包时返回空字符串。
 *
 * @param enabledToolPacks 用户在设置中启用的工具包名称列表
 * @param hasWorkspace 当前会话是否绑定了工作区（影响 requiresWorkspace=true 的工具包）
 */
export function buildToolPackGuide(
  enabledToolPacks: string[],
  hasWorkspace: boolean,
): string {
  const enabledSet = new Set(enabledToolPacks);
  const visiblePacks = OPTIONAL_TOOL_PACKS.filter((pack) => {
    if (!enabledSet.has(pack.name)) return false;
    if (pack.requiresWorkspace && !hasWorkspace) return false;
    return true;
  });

  // 常驻工具固定可见；可选工具包没有任何启用时也保留导览（让 Agent 知道至少有 memory）
  const lines: string[] = [];
  lines.push('\n## 可用工具类目');
  lines.push('以下类目的 MCP 工具已注册到本会话，详细参数 schema 默认不在上下文里——需要时可直接调用，系统会按需加载。');
  lines.push('');
  lines.push('**常驻**');
  lines.push('- 记忆系统（`mcp__dogear-memory__*`）：跨会话保存/查询用户偏好与反馈');

  if (visiblePacks.length > 0) {
    lines.push('');
    lines.push('**已启用工具包**');
    for (const pack of visiblePacks) {
      lines.push(`- ${pack.label}（\`mcp__${pack.mcpServerName}__*\`）：${pack.description}`);
    }
  }

  lines.push('');
  lines.push('未列出的能力（如其他股票/书籍/文章工具）当前未启用——如用户需要请提示其在「设置 → 工具包」开启对应类目。');

  return lines.join('\n');
}
