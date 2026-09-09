/**
 * 定时计划自定义 agent 的工具集组装（Worker 侧执行，不依赖渲染层）。
 *
 * 装配策略（对齐代码库真实开关来源，AppSettings 内没有工具包字段）：
 * - 基础文件工具 Read/Write/Edit + Glob/Grep：恒装，workspace 边界校验；不装 Bash
 * - 常驻能力域工具（与主会话同语义，tool-packs.ts 明确将其排除在可选工具包外）：
 *   dogear-memory（Recall/Save/Forget，autonomous 契约）+ dogear-memory-review（报告读写）
 * - 可选工具包（article / browser / stock-quote / stock-analysis / stock-announcement / stock-picking）：
 *   按工作区 config.json 的 enabledToolPacks 过滤，与设置页 ToolPacksTab 同源
 */
import path from 'node:path';
import { safeJsonRead } from '../safe-json.js';
import type { ToolDef } from '../../agents/pi/tool-adapter.js';
import { createWorkspaceFileToolDefs } from '../../agents/tools/workspace-file-tools.js';
import { createSearchToolDefs } from '../../agents/pi-session/search-tools.js';
import { createMemoryToolDefs } from '../../agents/tools/memory-tools.js';
import { createReviewToolDefs } from '../../agents/tools/review-tools.js';
import { createArticleToolDefs } from '../../agents/tools/article-tools.js';
import { createBrowserToolDefs } from '../../agents/tools/browser-tools.js';
import { createStockToolDefs } from '../../agents/tools/stock-tools.js';
import { createStockAnalysisToolDefs } from '../../agents/tools/stock-analysis-tools.js';
import { createAnnouncementToolDefs } from '../../agents/tools/stock-announcement-tools.js';
import { createStockPickingToolDefs } from '../../agents/tools/stock-picking-tools.js';

async function readEnabledToolPacks(configDir: string, workspaceId: string): Promise<string[]> {
  const configPath = path.join(configDir, 'workspaces', workspaceId, 'config.json');
  const config = await safeJsonRead<{ enabledToolPacks?: unknown }>(configPath, {});
  const packs = config.enabledToolPacks;
  return Array.isArray(packs) ? packs.filter((p: unknown): p is string => typeof p === 'string') : [];
}

export async function buildCustomToolSet(
  workspaceId: string,
  workspacePath: string,
  configDir: string,
  override?: string[],
): Promise<ToolDef[]> {
  const toolDefs: ToolDef[] = [
    ...createWorkspaceFileToolDefs(workspacePath),
    ...createSearchToolDefs([workspacePath]),
    ...createMemoryToolDefs(workspacePath, { autonomous: true }),
    ...createReviewToolDefs(workspaceId, workspacePath),
  ];

  const packNames = override !== undefined ? override : await readEnabledToolPacks(configDir, workspaceId);
  const enabledPacks = new Set(packNames.filter((p): p is string => typeof p === 'string'));
  if (enabledPacks.has('article')) {
    toolDefs.push(...createArticleToolDefs(workspacePath));
  }
  if (enabledPacks.has('browser')) {
    toolDefs.push(...createBrowserToolDefs({ workspacePath, workspaceId }));
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
