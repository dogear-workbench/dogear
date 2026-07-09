/**
 * 智能分类 MCP Server 工具（dogear-smart-category）
 *
 * CATEGORIZE_SESSION agent 用：ListCategories / SaveCategory
 * 由 Phase 3 worker 在每次"无阈值匹配"时启动一次 headless query 调用。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  readIndex, writeIndex, pushGroup, appendDecision, newCategory, mergeCategories,
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
    description: '保存分类决策（JOIN_EXISTING / NEW_CATEGORY / MERGE_CATEGORIES）',
    server: 'dogear-smart-category',
    category: 'memory',
  },
  {
    name: 'PruneCategoryTags',
    description: '覆写指定分类的 anchorTags 数组（整体替换，最多 10 个）',
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
        .describe('可选：新标签若语义贴近且能丰富分类画像就加进 anchorTags；否则留空。与 replaceAnchorTags 互斥'),
      replaceAnchorTags: z.array(z.string()).max(10).optional()
        .describe('可选：整体覆写该分类的 anchorTags（不是新增）。与 addAnchorTags 互斥；当前 anchorTags 已达 10 个上限时必须用这个才能生效'),
      reason: z.string().optional().describe('简短决策理由（供审计）'),
    }),
    z.object({
      type: z.literal('NEW_CATEGORY'),
      name: z.string().min(1).max(20).describe('分类名（2-6 字短词组）'),
      anchorTags: z.array(z.string()).min(1).max(10).describe('该分类的 anchor 标签集，最多 10 个'),
      redistribute: z.array(z.object({
        groupId: z.string(),
        moveToCategoryId: z.string().describe('目标分类 id；新分类用 "__NEW__" 占位'),
      })).optional().describe('受影响候选迁移列表（最多由系统注入的候选数量）'),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('MERGE_CATEGORIES'),
      fromIds: z.tuple([z.string(), z.string()]).describe('待合并的两个现有分类 id'),
      name: z.string().min(1).max(20).describe('合并后新分类的名称'),
      anchorTags: z.array(z.string()).min(1).max(10).describe('合并后新分类的 anchor 标签集，最多 10 个'),
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
        '保存分类决策。action.type=JOIN_EXISTING 归入现有分类（可附 addAnchorTags 扩 anchor，或 replaceAnchorTags 整体覆写，二者互斥），NEW_CATEGORY 新建分类（可附 redistribute 迁移名单），或 MERGE_CATEGORIES 合并两个现有分类为一个新分类。已达上限时 NEW_CATEGORY 会被拒绝，需先 MERGE_CATEGORIES 腾位置。',
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
                return { content: [{ type: 'text' as const, text: `Error: 分类 ${action.categoryId} 不存在` }], isError: true };
              }
              if (action.addAnchorTags && action.replaceAnchorTags) {
                return { content: [{ type: 'text' as const, text: 'Error: addAnchorTags 与 replaceAnchorTags 互斥，只能二选一' }], isError: true };
              }
              let nextAnchorTags: string[];
              if (action.replaceAnchorTags) {
                nextAnchorTags = action.replaceAnchorTags;
              } else {
                const addTags = action.addAnchorTags ?? [];
                nextAnchorTags = [...new Set([...cat.anchorTags, ...addTags])];
                if (nextAnchorTags.length > 10) {
                  return { content: [{ type: 'text' as const, text: 'Error: 该分类已达 10 tag 上限，请用 replaceAnchorTags 覆写或不加' }], isError: true };
                }
              }
              const updated = {
                ...pushGroup(cat, args.groupId),
                anchorTags: nextAnchorTags,
                updatedAt: nowIso,
              };
              idx.categories = idx.categories.map((c) => (c.id === cat.id ? updated : c));
              idx = appendDecision(idx, {
                time: nowIso,
                groupId: args.groupId,
                decision: 'join',
                reason: action.reason,
              });
            } else if (action.type === 'MERGE_CATEGORIES') {
              try {
                idx = mergeCategories(idx, action.fromIds, action.name, action.anchorTags);
              } catch (mergeError) {
                const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);
                return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
              }
              idx = appendDecision(idx, {
                time: nowIso,
                groupId: args.groupId,
                decision: 'merge',
                reason: action.reason,
              });
            } else {
              // NEW_CATEGORY
              if (idx.categories.length >= maxCategories) {
                return { content: [{ type: 'text' as const, text: `Error: 已达分类上限 ${maxCategories}，必须 JOIN_EXISTING` }], isError: true };
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

      tool(
        'PruneCategoryTags',
        '覆写指定分类的 anchorTags 数组（不是增删，是整体替换）。最多 10 个。',
        z.object({
          workspaceId: z.string().describe('工作区 ID'),
          categoryId: z.string().describe('目标分类 ID'),
          newAnchorTags: z.array(z.string()).min(1).max(10).describe('覆写后的完整 anchorTags 数组，最多 10 个'),
          reason: z.string().optional().describe('简短决策理由（供审计）'),
        }).shape,
        async (args) => {
          try {
            let idx = await readIndex(args.workspaceId);
            const cat = idx.categories.find((c) => c.id === args.categoryId);
            if (!cat) {
              return { content: [{ type: 'text' as const, text: `Error: 分类 ${args.categoryId} 不存在` }], isError: true };
            }
            const nowIso = new Date().toISOString();
            idx.categories = idx.categories.map((c) =>
              (c.id === args.categoryId ? { ...c, anchorTags: args.newAnchorTags, updatedAt: nowIso } : c));
            idx = appendDecision(idx, {
              time: nowIso,
              groupId: '',
              decision: 'prune',
              reason: args.reason,
            });
            await writeIndex(args.workspaceId, idx);
            return {
              content: [{ type: 'text' as const, text: 'OK' }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `覆写 anchorTags 失败: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
