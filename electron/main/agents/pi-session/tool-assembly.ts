import path from 'path';
import type { ToolDef } from '../pi/tool-adapter.js';
import { createSkillTool, type SkillEntry } from './skill-loader.js';
import { createSearchToolDefs } from './search-tools.js';
import { isBasicToolName } from './permission-rules.js';
import { TOOL_PACK_TO_ABILITY } from '../ability-registry.js';
import { OPTIONAL_TOOL_PACKS } from '../../services/tool-packs.js';
import { PERSONAL_WORKSPACE_ID } from '../../types.js';
import type { SubAgentProfile } from '../../services/settings-types.js';
import type { PiSessionConfig } from './pi-session-config.js';
import { createMemoryToolDefs } from '../tools/memory-tools.js';
import { createArticleToolDefs } from '../tools/article-tools.js';
import { createBrowserToolDefs } from '../tools/browser-tools.js';
import { createExtensionToolDefs } from '../tools/extension-tools.js';
import { createStockToolDefs } from '../tools/stock-tools.js';
import { createStockAnalysisToolDefs } from '../tools/stock-analysis-tools.js';
import { createAnnouncementToolDefs } from '../tools/stock-announcement-tools.js';
import { createStockPickingToolDefs } from '../tools/stock-picking-tools.js';
import { createWebMcpToolDefs } from '../tools/web-mcp-tools.js';
import { createGroupToolDefs } from '../tools/group-tools.js';
import { createDelegationToolDefs, type DelegationToolsOpts } from '../tools/delegation-tools.js';
import { createNotesToolDefs } from '../tools/notes-tools.js';
import { createForkSessionToolDefs } from '../tools/fork-session-tool.js';
import { createTaskToolDefs } from '../tools/task-tools.js';
import { createGitToolDefs } from '../tools/git-tools.js';
import { createGroupContextToolDefs, createSiblingToolDefs, createHistorySearchToolDefs } from '../tools/reference-tools.js';

/**
 * 子会话按 Profile 过滤 skill entries。
 * builtin 段：article-parser 仅当 article===true，browser-exploration 仅当 browser===true，
 * stock-analysis/stock-picking 仅当 stock===true，其余按 skills[] 匹配；
 * custom 段：仅保留 skills[] 中列出的；
 * user 段：仅保留 customSkills[] 中列出的。
 */
export function filterSkillsForSubAgent(
  entries: SkillEntry[],
  profile: SubAgentProfile,
  scanDirs: { builtin: string; custom: string; user: string },
): SkillEntry[] {
  const ab = profile.enabledAbilities;
  const isUnder = (filePath: string, dir: string): boolean => {
    const rel = path.relative(dir, filePath);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  return entries.filter((entry) => {
    const fp = entry.bodyPath;
    if (isUnder(fp, scanDirs.builtin)) {
      if (entry.name === 'article-parser') return ab.article === true;
      if (entry.name === 'browser-exploration') return ab.browser === true;
      if (entry.name === 'stock-analysis' || entry.name === 'stock-picking') return ab.stock === true;
      return ab.skills?.includes(entry.name) ?? false;
    }
    if (isUnder(fp, scanDirs.custom)) return ab.skills?.includes(entry.name) ?? false;
    if (isUnder(fp, scanDirs.user)) return ab.customSkills?.includes(entry.name) ?? false;
    return false;
  });
}

/**
 * 计算子会话的 activeToolNames（白名单）。主会话返回 undefined = 全部激活。
 *
 * 基础文件工具（read/write/edit/bash）不在 toolDefs 中但始终创建，取 enabledBasicTools 的交集；
 * read_terminal/kill_terminal 无独立开关，跟随 bash 联动激活。
 * toolDefs 中的 Glob/Grep 属基础工具，靠 enabledBasicTools 控制可见性。
 * toolDefs 中的 Skill 工具如果已创建（有勾选 skill）则始终激活。
 * 非基础工具（能力域工具）一旦创建即激活。
 */
export function computeSubAgentActiveTools(profile: SubAgentProfile, toolDefs: ToolDef[]): string[] {
  const names = new Set<string>();
  const enabledBasicSet = new Set(profile.enabledBasicTools);
  const BUILTIN_FILE_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'read_terminal', 'kill_terminal']);

  for (const name of profile.enabledBasicTools) {
    if (BUILTIN_FILE_TOOLS.has(name)) names.add(name);
    if (name === 'bash') {
      names.add('read_terminal');
      names.add('kill_terminal');
    }
  }

  for (const def of toolDefs) {
    if (isBasicToolName(def.name) && def.name !== 'Skill') {
      if (enabledBasicSet.has(def.name)) names.add(def.name);
    } else {
      names.add(def.name);
    }
  }

  return [...names];
}

/** 工具包注册辅助：校验并记录工具名→工具包标识映射，供权限批量免确认判定使用 */
export function registerPack(toolPackMap: Map<string, string>, packName: string, defs: ToolDef[]): ToolDef[] {
  for (const def of defs) {
    if (isBasicToolName(def.name)) {
      throw new Error(`基础工具 ${def.name} 不得归类到工具包 ${packName}`);
    }
    if (toolPackMap.has(def.name)) {
      throw new Error(`工具 ${def.name} 重复归类到工具包 ${toolPackMap.get(def.name)} 与 ${packName}`);
    }
    toolPackMap.set(def.name, packName);
  }
  return defs;
}

/**
 * 主会话工具构建：
 * Skill 工具 + Grep/Glob + dogear-memory（包开关或无工作区现状兜底） + 按 enabledToolPacks 挂载可选工具包（skill 型包需包总开关生效）
 * + extension（并入 browser 包：只受 browser 包总开关 gate，enabledToolPacks 残留 extension 静默忽略）
 * + 组状态卡组（dogear-group-context，属组且会话组包生效）
 * + 协作三组（dogear-group/delegation/sibling，属组且 agent-collab 包生效）
 * + dogear-notes（工作区且 notes 包生效）
 * + dogear-tasks（工作区且 notes 包生效；任务执行会话派单保底不受开关约束）
 * + dogear-git（工作区且 workspace-git 包生效）
 * + dogear-history 跨会话检索组（不在包体系，工作区即注册的常驻基础设施）
 */
export function buildMainAgentToolDefs(
  config: PiSessionConfig,
  toolPackMap: Map<string, string>,
  skillEntries: SkillEntry[],
  activeAbilities: Set<string>,
  basePaths: string[],
): ToolDef[] {
  const toolDefs: ToolDef[] = [
    createSkillTool(skillEntries),
    ...createSearchToolDefs(basePaths),
  ];

  // 无工作区会话现状即注册 memory 工具，而 memory 包触发条件含 hasWorkspace，直接查包会吞掉该场景，需维持现状
  if (!config.workspacePath || activeAbilities.has('memory')) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-memory', createMemoryToolDefs(config.workspaceId)));
  }

  for (const pack of OPTIONAL_TOOL_PACKS) {
    if (!config.enabledToolPacks.includes(pack.name)) continue;
    // skill 型双闸：enabledToolPacks 是子开关，包总开关在注册表，未生效则工具包不挂载（与 skill 索引剔除同性质）
    const abilityKey = TOOL_PACK_TO_ABILITY.get(pack.name);
    if (abilityKey && !activeAbilities.has(abilityKey)) continue;
    switch (pack.name) {
      case 'article':
        if (config.workspacePath) {
          toolDefs.push(...registerPack(toolPackMap, pack.name, createArticleToolDefs(config.workspacePath)));
        }
        break;
      case 'browser':
        toolDefs.push(...registerPack(toolPackMap, pack.name, createBrowserToolDefs({ conversationId: config.conversationId, workspacePath: config.workspacePath, workspaceId: config.workspaceId })));
        break;
      case 'stock-quote':
        toolDefs.push(...registerPack(toolPackMap, pack.name, createStockToolDefs()));
        break;
      case 'stock-analysis':
        toolDefs.push(...registerPack(toolPackMap, pack.name, createStockAnalysisToolDefs()));
        break;
      case 'stock-announcement':
        toolDefs.push(...registerPack(toolPackMap, pack.name, createAnnouncementToolDefs()));
        break;
      case 'stock-picking':
        toolDefs.push(...registerPack(toolPackMap, pack.name, createStockPickingToolDefs()));
        break;
      case 'web-mcp': {
        // hasBrowser 必须与实际挂载一致：browser 子开关残留时主会话不会真挂 browser 工具，只判总开关会复现死链
        const hasBrowser = activeAbilities.has('browser') && config.enabledToolPacks.includes('browser');
        toolDefs.push(...registerPack(toolPackMap, pack.name, createWebMcpToolDefs({ fallbackHint: hasBrowser ? 'browser-tools' : 'browser-subagent' })));
        break;
      }
      default:
        break;
    }
  }

  // extension 并入 browser 包：注册只看 browser 包总开关，enabledToolPacks 残留 extension 静默忽略
  if (activeAbilities.has('browser')) {
    toolDefs.push(...registerPack(toolPackMap, 'extension', createExtensionToolDefs({ conversationId: config.conversationId })));
  }

  if (config.groupId && activeAbilities.has('group-context')) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-group-context', createGroupContextToolDefs({
      workspaceId: config.workspaceId,
      groupId: config.groupId,
      selfConversationId: config.conversationId,
    })));
  }

  if (config.groupId && activeAbilities.has('agent-collab')) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-group', createGroupToolDefs(config.workspaceId, config.groupId)));
    const delegationOpts: DelegationToolsOpts = {
      role: 'main',
      workspaceId: config.workspaceId,
      groupId: config.groupId,
      conversationId: config.conversationId,
    };
    toolDefs.push(...registerPack(toolPackMap, 'dogear-delegation', createDelegationToolDefs(delegationOpts)));
    toolDefs.push(...registerPack(toolPackMap, 'dogear-sibling', createSiblingToolDefs({
      workspaceId: config.workspaceId,
      groupId: config.groupId,
      parentConversationId: config.parentConversationId,
    })));
  }

  if (config.workspacePath && activeAbilities.has('notes')) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-notes', createNotesToolDefs(config.workspaceId, {
      workspaceId: config.workspaceId,
      conversationId: config.conversationId,
    })));
  }

  // shunt 包生效（resolveAbilities 已含主会话 + 有工作区 + 有组），executor 段级裁剪在此显式排除
  if (config.workspacePath && config.groupId && activeAbilities.has('shunt') && !config.executor) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-shunt', createForkSessionToolDefs({
      workspaceId: config.workspaceId,
      groupId: config.groupId,
      conversationId: config.conversationId,
    })));
  }

  // workspace-git 包生效即注册（主/子会话同条件，无 Profile 子开关）
  if (config.workspacePath && activeAbilities.has('workspace-git')) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-git', createGitToolDefs({
      workspaceId: config.workspaceId,
      workspacePath: config.workspacePath,
    })));
  }

  // dogear-tasks 归 notes 包，任务执行会话的申报工具（ReportTaskResult 所在组）派单保底注册；
  // dogear-history（跨会话检索）不在能力包体系，工作区即注册的常驻基础设施
  if (config.workspacePath && (activeAbilities.has('notes') || config.executor)) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-tasks', createTaskToolDefs(config.workspacePath, {
      workspaceId: config.workspaceId,
      conversationId: config.conversationId,
    })));
  }
  // dogear-history（跨会话检索）不在能力包体系，工作区即注册的常驻基础设施；personal 临时工作区放行（只读话题工具辅助归置建议）
  if (config.workspacePath || config.workspaceId === PERSONAL_WORKSPACE_ID) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-history', createHistorySearchToolDefs(config.workspaceId)));
  }

  return toolDefs;
}

/**
 * 子会话工具构建（Profile 驱动，能力包开关经 activeAbilities 交集）：
 * - 基础工具（read/write/edit/bash/Glob/Grep）：始终全部创建，activeToolNames 控制可见性
 * - Skill 工具：有 ≥1 skill 勾选时创建
 * - dogear-memory：memory 包生效（含 Profile 的 memory===true 子开关，由 resolveAbilities 并集）
 * - stock/article/browser 工具包：对应能力包生效（Profile 子开关并入包解析）
 * - extension 工具组：browser 包生效且 Profile extension===true 双闸
 * - web-mcp 工具包：web 包生效（Profile 子开关已并入 resolveAbilities）
 * - dogear-history 跨会话检索组：工作区即注册（不查 Profile 子开关——通用检索是基础设施）
 * - dogear-git：workspace-git 包生效即注册（无 Profile 子开关，子会话查历史/落提交与主会话同能力）
 * - dogear-group + dogear-delegation：始终注册（固定，交付基础设施，不受包开关影响）
 * - dogear-group-context（组状态卡）：会话组包生效（属组即有包内语义，无 Profile 子开关）
 * - dogear-sibling（兄弟会话）：协作包生效（子会话对协作包强制生效，无 Profile 子开关）
 */
export function buildSubAgentToolDefs(
  config: PiSessionConfig,
  toolPackMap: Map<string, string>,
  profile: SubAgentProfile,
  skillEntries: SkillEntry[],
  activeAbilities: Set<string>,
  basePaths: string[],
): ToolDef[] {
  const ab = profile.enabledAbilities;
  const toolDefs: ToolDef[] = [];

  // Grep/Glob：始终创建（基础工具，activeToolNames 控制可见性）
  toolDefs.push(...createSearchToolDefs(basePaths));

  // Skill 工具：有 ≥1 skill 勾选时创建
  if (skillEntries.length > 0) {
    toolDefs.push(createSkillTool(skillEntries));
  }

  // dogear-memory：memory 包生效（Profile 子开关已并入 resolveAbilities）
  if (activeAbilities.has('memory')) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-memory', createMemoryToolDefs(config.workspaceId)));
  }

  // stock 工具包：stock 包生效
  if (activeAbilities.has('stock')) {
    toolDefs.push(...registerPack(toolPackMap, 'stock-quote', createStockToolDefs()));
    toolDefs.push(...registerPack(toolPackMap, 'stock-analysis', createStockAnalysisToolDefs()));
    toolDefs.push(...registerPack(toolPackMap, 'stock-announcement', createAnnouncementToolDefs()));
    toolDefs.push(...registerPack(toolPackMap, 'stock-picking', createStockPickingToolDefs()));
  }

  // article 工具包：article 包生效
  if (activeAbilities.has('article') && config.workspacePath) {
    toolDefs.push(...registerPack(toolPackMap, 'article', createArticleToolDefs(config.workspacePath)));
  }

  // browser 工具包：browser 包生效（Profile 级独立生效，不受 enabledToolPacks 约束）
  if (activeAbilities.has('browser')) {
    toolDefs.push(...registerPack(toolPackMap, 'browser', createBrowserToolDefs({ conversationId: config.conversationId, workspacePath: config.workspacePath, workspaceId: config.workspaceId })));
  }

  // extension：并入 browser 包后是双闸——browser 包生效（Profile 子开关已并入 resolveAbilities）+ extension===true
  if (activeAbilities.has('browser') && ab.extension === true) {
    toolDefs.push(...registerPack(toolPackMap, 'extension', createExtensionToolDefs({ conversationId: config.conversationId })));
  }

  // web-mcp 工具包：web 包生效（Profile 子开关已并入 resolveAbilities）
  if (activeAbilities.has('web-mcp')) {
    toolDefs.push(...registerPack(toolPackMap, 'web-mcp', createWebMcpToolDefs({ fallbackHint: activeAbilities.has('browser') ? 'browser-tools' : 'none' })));
  }

  // dogear-history：工作区即注册，通用检索基础设施，不查 Profile 子开关
  if (config.workspacePath) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-history', createHistorySearchToolDefs(config.workspaceId)));
  }

  // dogear-git：workspace-git 包生效即注册（无 Profile 子开关，与 agent-collab 同模式：子会话查历史/落提交是基础设施能力）
  if (config.workspacePath && activeAbilities.has('workspace-git')) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-git', createGitToolDefs({
      workspaceId: config.workspaceId,
      workspacePath: config.workspacePath,
    })));
  }

  // dogear-group / dogear-delegation / dogear-group-context / dogear-sibling
  if (config.groupId) {
    toolDefs.push(...registerPack(toolPackMap, 'dogear-group', createGroupToolDefs(config.workspaceId, config.groupId)));

    // dogear-delegation：始终注册（固定）
    const delegationOpts: DelegationToolsOpts = {
      role: 'sub',
      workspaceId: config.workspaceId,
      groupId: config.groupId,
      conversationId: config.conversationId,
      parentConversationId: config.parentConversationId ?? '',
    };
    toolDefs.push(...registerPack(toolPackMap, 'dogear-delegation', createDelegationToolDefs(delegationOpts)));

    // dogear-group-context：随会话组包（reference 子开关已退役）
    if (activeAbilities.has('group-context')) {
      toolDefs.push(...registerPack(toolPackMap, 'dogear-group-context', createGroupContextToolDefs({
        workspaceId: config.workspaceId,
        groupId: config.groupId,
        selfConversationId: config.conversationId,
      })));
    }

    // dogear-sibling：随协作包（子会话强制生效）
    if (activeAbilities.has('agent-collab')) {
      toolDefs.push(...registerPack(toolPackMap, 'dogear-sibling', createSiblingToolDefs({
        workspaceId: config.workspaceId,
        groupId: config.groupId,
        parentConversationId: config.parentConversationId,
        selfConversationId: config.conversationId,
      })));
    }
  }


  return toolDefs;
}
