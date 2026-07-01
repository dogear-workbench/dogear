/**
 * 智能分类 MCP Server 工具（dogear-smart-category）
 *
 * CATEGORIZE_SESSION agent 用：ListCategories / SaveCategory
 * 由 Phase 3 worker 在每次"无阈值匹配"时启动一次 headless query 调用。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  readIndex, writeIndex, pushGroup, appendDecision, newCategory,
} from '../../services/memory/smart-category-store.js';
import { loadSettings } from '../../services/settings-service.js';
import { registerTools } from './tool-registry.js';
import { mainLogger } from '../logger.js';
import { getByWorkspaceId } from '../../services/conversation-service.js';
import * as groupService from '../../services/group-service.js';
import { deriveGroupTitle } from '../../services/group-helpers.js';

registerTools([
  {
    name: 'ListCategories',
    description: '读取当前工作区智能分类（含 anchorTags、样例组标题、atLimit/maxCategories）',
    server: 'dogear-smart-category',
    category: 'memory',
  },
  {
    name: 'SaveCategory',
    description: '保存分类决策（JOIN_EXISTING 或 NEW_CATEGORY）',
    server: 'dogear-smart-category',
    category: 'memory',
  },
]);

const listArgs = z.object({
  workspaceId: z.string().describe('工作区 ID'),
});

const saveArgs = z.object({
  workspaceId: z.string().describe('工作区 ID'),
  groupId: z.string().describe('待归类的组 ID'),
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('JOIN_EXISTING'),
      categoryId: z.string(),
      addAnchorTags: z.array(z.string()).optional()
        .describe('可选：新标签若语义贴近且能丰富分类画像就加进 anchorTags；否则留空'),
      reason: z.string().optional().describe('简短决策理由（供审计）'),
    }),
    z.object({
      type: z.literal('NEW_CATEGORY'),
      name: z.string().min(1).max(20).describe('分类名（2-6 字短词组）'),
      anchorTags: z.array(z.string()).min(1).describe('该分类的 anchor 标签集'),
      redistribute: z.array(z.object({
        groupId: z.string(),
        moveToCategoryId: z.string().describe('目标分类 id；新分类用 "__NEW__" 占位'),
      })).optional().describe('受影响候选迁移列表（最多由系统注入的候选数量）'),
      reason: z.string().optional(),
    }),
  ]),
});

/**
 * 创建智能分类 MCP server。
 */
export function createCategoryTools() {
  return createSdkMcpServer({
    name: 'dogear-smart-category',
    version: '1.0.0',
    tools: [
      tool(
        'ListCategories',
        '读取当前工作区的智能分类列表，返回 { categories: [{id, name, anchorTags, groupCount, sampleGroupTitles}], atLimit, maxCategories }。决策前必须调一次。',
        listArgs.shape,
        async (args) => {
          try {
            const idx = await readIndex(args.workspaceId);
            const allConvs = await getByWorkspaceId(args.workspaceId);
            const enriched = await Promise.all(idx.categories.map(async (c) => {
              const sampleIds = c.groupIds.slice(-3);
              const sampleTitles: string[] = [];
              for (const gid of sampleIds) {
                const group = await groupService.getGroup(args.workspaceId, gid);
                if (group) {
                  const groupConvs = allConvs.filter((conv) => conv.groupId === gid);
                  sampleTitles.push(deriveGroupTitle(group, groupConvs));
                }
              }
              return {
                id: c.id,
                name: c.name,
                anchorTags: c.anchorTags,
                groupCount: c.groupIds.length,
                sampleGroupTitles: sampleTitles,
              };
            }));
            const settings = await loadSettings();
            const maxCategories = settings.smartCategory?.maxCategories ?? 10;
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify(
                  { categories: enriched, atLimit: enriched.length >= maxCategories, maxCategories },
                  null, 2,
                ),
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `读取分类列表失败: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            };
          }
        },
      ),

      tool(
        'SaveCategory',
        '保存分类决策。action.type=JOIN_EXISTING 归入现有分类（可附 addAnchorTags 扩 anchor），或 NEW_CATEGORY 新建分类（可附 redistribute 迁移名单）。已达上限时 NEW_CATEGORY 会被拒绝。',
        saveArgs.shape,
        async (args) => {
          try {
            let idx = await readIndex(args.workspaceId);
            const settings = await loadSettings();
            const maxCategories = settings.smartCategory?.maxCategories ?? 10;
            const nowIso = new Date().toISOString();

            const action = args.action;
            if (action.type === 'JOIN_EXISTING') {
              const cat = idx.categories.find((c) => c.id === action.categoryId);
              if (!cat) {
                return {
                  content: [{ type: 'text' as const, text: `Error: 分类 ${action.categoryId} 不存在` }],
                  isError: true,
                };
              }
              const addTags = action.addAnchorTags ?? [];
              const updated = {
                ...pushGroup(cat, args.groupId),
                anchorTags: [...new Set([...cat.anchorTags, ...addTags])],
                updatedAt: nowIso,
              };
              idx.categories = idx.categories.map((c) => (c.id === cat.id ? updated : c));
              idx = appendDecision(idx, {
                time: nowIso,
                groupId: args.groupId,
                decision: 'join',
                reason: action.reason,
              });
            } else {
              // NEW_CATEGORY
              if (idx.categories.length >= maxCategories) {
                return {
                  content: [{ type: 'text' as const, text: `Error: 已达分类上限 ${maxCategories}，必须 JOIN_EXISTING` }],
                  isError: true,
                };
              }
              const cat = newCategory(action.name, action.anchorTags);
              cat.groupIds = [args.groupId];
              idx.categories.push(cat);

              // 处理 redistribute
              for (const m of action.redistribute ?? []) {
                const targetId = m.moveToCategoryId === '__NEW__' ? cat.id : m.moveToCategoryId;
                if (!idx.categories.some((c) => c.id === targetId)) {
                  mainLogger.warn(
                    `[smart-category] redistribute 跳过：moveToCategoryId=${m.moveToCategoryId} 既非 __NEW__ 也非任何现有分类，groupId=${m.groupId} 不动`,
                  );
                  continue;
                }
                for (const c of idx.categories) {
                  if (c.id !== targetId) {
                    c.groupIds = c.groupIds.filter((x) => x !== m.groupId);
                  }
                }
                const target = idx.categories.find((c) => c.id === targetId);
                if (target && !target.groupIds.includes(m.groupId)) {
                  target.groupIds.push(m.groupId);
                  target.updatedAt = nowIso;
                }
              }
              idx = appendDecision(idx, {
                time: nowIso,
                groupId: args.groupId,
                decision: 'new',
                reason: action.reason,
              });
            }

            await writeIndex(args.workspaceId, idx);
            return {
              content: [{ type: 'text' as const, text: 'OK' }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `保存分类失败: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
