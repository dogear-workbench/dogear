/**
 * 定时计划自定义 agent 的工具集组装（Worker 侧执行，不依赖渲染层）。
 *
 * 装配策略：
 * - 基础文件工具 Read/Write/Edit + Glob/Grep：恒装，workspace 边界校验；不装 Bash
 * - memory（Recall/Save/Forget）与 notes（巡检报告等任务产物落笔记卡片）：定时任务固定层，
 *   按 scenePackEnabled(pack, config, 'scheduler') 三级回退裁决（无覆盖时 defaultEnabled=true = 装载，等价现状）
 * - 可选工具包（article / browser / stock-quote / stock-analysis / stock-announcement / stock-picking）：
 *   按工作区 config.json 的 enabledToolPacks 过滤，与设置页 ToolPacksTab 同源
 */
import path from 'node:path';
import { safeJsonRead } from '../safe-json.js';
import type { ToolDef } from '../../agents/pi/tool-adapter.js';
import { ABILITY_PACKS, scenePackEnabled } from '../../agents/ability-registry.js';
import type { WorkspaceConfig } from '../workspace-config-service.js';
import { createWorkspaceFileToolDefs } from '../../agents/tools/workspace-file-tools.js';
import { createSearchToolDefs } from '../../agents/pi-session/search-tools.js';
import { createMemoryToolDefs } from '../../agents/tools/memory-tools.js';
import { createNotesToolDefs } from '../../agents/tools/notes-tools.js';
import { createArticleToolDefs } from '../../agents/tools/article-tools.js';
import { createBrowserToolDefs } from '../../agents/tools/browser-tools.js';
import { createWebMcpToolDefs } from '../../agents/tools/web-mcp-tools.js';
import { createStockToolDefs } from '../../agents/tools/stock-tools.js';
import { createStockAnalysisToolDefs } from '../../agents/tools/stock-analysis-tools.js';
import { createAnnouncementToolDefs } from '../../agents/tools/stock-announcement-tools.js';
import { createStockPickingToolDefs } from '../../agents/tools/stock-picking-tools.js';

async function readWorkspaceConfig(configDir: string, workspaceId: string): Promise<WorkspaceConfig> {
  const configPath = path.join(configDir, 'workspaces', workspaceId, 'config.json');
  const stored = await safeJsonRead<Partial<WorkspaceConfig>>(configPath, {});
  return {
    enabledToolPacks: Array.isArray(stored.enabledToolPacks)
      ? stored.enabledToolPacks.filter((p): p is string => typeof p === 'string')
      : [],
    enabledSkills: [],
    abilityOverrides: stored.abilityOverrides,
    sceneOverrides: stored.sceneOverrides,
  };
}

export async function buildCustomToolSet(
  workspaceId: string,
  workspacePath: string,
  configDir: string,
  override?: string[],
): Promise<ToolDef[]> {
  const wsConfig = await readWorkspaceConfig(configDir, workspaceId);
  const schedulerPackEnabled = (packKey: string): boolean => {
    const pack = ABILITY_PACKS.find((p) => p.key === packKey);
    return pack ? scenePackEnabled(pack, wsConfig, 'scheduler') : true;
  };

  const toolDefs: ToolDef[] = [
    ...createWorkspaceFileToolDefs(workspacePath),
    ...createSearchToolDefs([workspacePath]),
  ];
  if (schedulerPackEnabled('memory')) toolDefs.push(...createMemoryToolDefs(workspaceId));
  if (schedulerPackEnabled('notes')) toolDefs.push(...createNotesToolDefs(workspaceId));

  const packNames = override !== undefined ? override : wsConfig.enabledToolPacks;
  const enabledPacks = new Set(packNames.filter((p): p is string => typeof p === 'string'));
  if (enabledPacks.has('article')) {
    toolDefs.push(...createArticleToolDefs(workspacePath));
  }
  if (enabledPacks.has('browser')) {
    toolDefs.push(...createBrowserToolDefs({ workspacePath, workspaceId }));
  }
  if (enabledPacks.has('web-mcp')) {
    toolDefs.push(...createWebMcpToolDefs({ fallbackHint: enabledPacks.has('browser') ? 'browser-tools' : 'none' }));
  }
  if (enabledPacks.has('stock-quote')) {
    toolDefs.push(...createStockToolDefs());
  }
  if (enabledPacks.has('stock-analysis')) {
    toolDefs.push(...createStockAnalysisToolDefs());
  }
  if (enabledPacks.has('stock-announcement')) {
    toolDefs.push(...createAnnouncementToolDefs());
  }
  if (enabledPacks.has('stock-picking')) {
    toolDefs.push(...createStockPickingToolDefs());
  }

  return toolDefs;
}
