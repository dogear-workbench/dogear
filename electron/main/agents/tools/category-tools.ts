/**
 * 智能分类 MCP Server 工具（dogear-smart-category）
 *
 * CATEGORIZE_SESSION agent 用：ListCategories / SaveCategoryJoin / SaveCategoryNew / SaveCategoryMerge
 * CATEGORIZE_ORGANIZE agent 用：ListCategories / PruneCategoryTags / SaveCategoryMerge
 *
 * 三种保存动作拆成独立工具（原 SaveCategory 用 discriminatedUnion + tuple，
 * GLM 等国内 Anthropic 兼容层不吃 oneOf / prefixItems，拆开后 schema 纯 object 全平台通吃）。
 */
import { z } from 'zod';
import {
  readIndex, writeIndex, pushGroup, appendDecision, newCategory, mergeCategories,
} from '../../services/memory/smart-category-store.js';
import { loadSettings } from '../../services/settings-service.js';
import { registerToolGroup } from './tool-registry.js';
import { mainLogger } from '../logger.js';
import { getByWorkspaceId } from '../../services/conversation-service.js';
import * as groupService from '../../services/group-service.js';
import { deriveGroupTitle } from '../../services/group-helpers.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';


const listArgs = z.object({
  workspaceId: z.string().describe('工作区 ID'),
});

const joinArgs = z.object({
  workspaceId: z.string().describe('工作区 ID'),
  groupId: z.string().describe('待归类的组 ID'),
  categoryId: z.string().describe('归入的目标分类 ID'),
  addAnchorTags: z.array(z.string()).optional()
    .describe('可选：新标签若语义贴近且能丰富分类画像就加进 anchorTags；否则留空。与 replaceAnchorTags 互斥'),
  replaceAnchorTags: z.array(z.string()).max(10).optional()
    .describe('可选：整体覆写该分类的 anchorTags（不是新增）。与 addAnchorTags 互斥；当前 anchorTags 已达 10 个上限时必须用这个才能生效'),
  reason: z.string().optional().describe('简短决策理由（供审计）'),
});

const newArgs = z.object({
  workspaceId: z.string().describe('工作区 ID'),
  groupId: z.string().describe('待归类的组 ID'),
  name: z.string().min(1).max(20).describe('分类名（2-6 字短词组）'),
  anchorTags: z.array(z.string()).min(1).max(10).describe('该分类的 anchor 标签集，最多 10 个'),
  redistribute: z.array(z.object({
    groupId: z.string(),
    moveToCategoryId: z.string().describe('目标分类 id；新分类用 "__NEW__" 占位'),
  })).optional().describe('受影响候选迁移列表（最多由系统注入的候选数量）'),
  reason: z.string().optional().describe('简短决策理由（供审计）'),
});

const mergeArgs = z.object({
  workspaceId: z.string().describe('工作区 ID'),
  groupId: z.string().describe('触发本次决策的组 ID；批量整理场景无触发组时传空字符串 ""'),
  fromIds: z.array(z.string()).length(2).describe('待合并的两个现有分类 id（数组长度必须为 2）'),
  name: z.string().min(1).max(20).describe('合并后新分类的名称'),
  anchorTags: z.array(z.string()).min(1).max(10).describe('合并后新分类的 anchor 标签集，最多 10 个'),
  reason: z.string().optional().describe('简短决策理由（供审计）'),
});

const pruneArgs = z.object({
  workspaceId: z.string().describe('工作区 ID'),
  categoryId: z.string().describe('目标分类 ID'),
  newAnchorTags: z.array(z.string()).min(1).max(10).describe('覆写后的完整 anchorTags 数组，最多 10 个'),
  reason: z.string().optional().describe('简短决策理由（供审计）'),
});

export function createCategoryToolDefs(): ToolDef[] {
  return [
    defineTool(
      'ListCategories',
      '查看智能分类列表',
      '读取当前工作区的智能分类列表，返回 { categories: [{id, name, anchorTags, groupCount, sampleGroupTitles}], atLimit, maxCategories }。',
      listArgs,
      async (args) => {
        try {
          const idx = await readIndex(args.workspaceId);
          const [allConvs, activeGroups] = await Promise.all([
            getByWorkspaceId(args.workspaceId),
            groupService.listActiveGroups(args.workspaceId),
          ]);
          const activeGroupIds = new Set(activeGroups.map((group) => group.id));
          const groupById = new Map(activeGroups.map((group) => [group.id, group]));
          const enriched = idx.categories.map((c) => {
            const groupIds = c.groupIds.filter((groupId) => activeGroupIds.has(groupId));
            const sampleTitles = groupIds.slice(-3).flatMap((groupId) => {
              const group = groupById.get(groupId);
              return group ? [deriveGroupTitle(group, allConvs.filter((conv) => conv.groupId === groupId))] : [];
            });
            return {
              id: c.id,
              name: c.name,
              anchorTags: c.anchorTags,
              groupCount: groupIds.length,
              sampleGroupTitles: sampleTitles,
            };
          });
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

    defineTool(
      'SaveCategoryJoin',
      '归入已有分类',
      '把 groupId 归入现有分类 categoryId。可选 addAnchorTags（扩展该分类 anchorTags）或 replaceAnchorTags（整体覆写），二者互斥；不加标签则留空。该分类当前 anchorTags 已达 10 上限时必须用 replaceAnchorTags 才能加新标签。',
      joinArgs,
      async (args) => {
        try {
          await groupService.requireActiveGroup(args.workspaceId, args.groupId);
          let idx = await readIndex(args.workspaceId);
          const nowIso = new Date().toISOString();

          const cat = idx.categories.find((c) => c.id === args.categoryId);
          if (!cat) {
            return { content: [{ type: 'text' as const, text: `Error: 分类 ${args.categoryId} 不存在` }], isError: true };
          }
          if (args.addAnchorTags && args.replaceAnchorTags) {
            return { content: [{ type: 'text' as const, text: 'Error: addAnchorTags 与 replaceAnchorTags 互斥，只能二选一' }], isError: true };
          }
          let nextAnchorTags: string[];
          if (args.replaceAnchorTags) {
            nextAnchorTags = args.replaceAnchorTags;
          } else {
            const addTags = args.addAnchorTags ?? [];
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
            reason: args.reason,
          });

          await writeIndex(args.workspaceId, idx);
          return { content: [{ type: 'text' as const, text: 'OK' }] };
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

    defineTool(
      'SaveCategoryNew',
      '新建分类并归入',
      '新建分类并把 groupId 放进去。可选 redistribute 迁移名单（moveToCategoryId="__NEW__" 表示迁到刚新建的这个分类）。',
      newArgs,
      async (args) => {
        try {
          await groupService.requireActiveGroup(args.workspaceId, args.groupId);
          for (const move of args.redistribute ?? []) {
            await groupService.requireActiveGroup(args.workspaceId, move.groupId);
          }
          let idx = await readIndex(args.workspaceId);
          const settings = await loadSettings();
          const maxCategories = settings.smartCategory?.maxCategories ?? 10;
          const nowIso = new Date().toISOString();

          if (idx.categories.length >= maxCategories) {
            return { content: [{ type: 'text' as const, text: `Error: 已达分类上限 ${maxCategories}，必须 SaveCategoryJoin` }], isError: true };
          }
          const cat = newCategory(args.name, args.anchorTags);
          cat.groupIds = [args.groupId];
          idx.categories.push(cat);

          for (const m of args.redistribute ?? []) {
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
            reason: args.reason,
          });

          await writeIndex(args.workspaceId, idx);
          return { content: [{ type: 'text' as const, text: 'OK' }] };
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

    defineTool(
      'SaveCategoryMerge',
      '合并两个分类',
      '把 fromIds 里的两个现有分类合并成一个新分类，两者的组自动去重合并进新分类。fromIds 必须是长度为 2 的字符串数组。批量整理场景无触发组时 groupId 传空字符串 ""。',
      mergeArgs,
      async (args) => {
        try {
          let idx = await readIndex(args.workspaceId);
          const nowIso = new Date().toISOString();

          // zod .length(2) 已保证运行时长度，这里做类型层的 tuple 断言
          const fromIds = args.fromIds as [string, string];
          try {
            idx = mergeCategories(idx, fromIds, args.name, args.anchorTags);
          } catch (mergeError) {
            const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);
            return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
          }
          idx = appendDecision(idx, {
            time: nowIso,
            groupId: args.groupId,
            decision: 'merge',
            reason: args.reason,
          });

          await writeIndex(args.workspaceId, idx);
          return { content: [{ type: 'text' as const, text: 'OK' }] };
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

    defineTool(
      'PruneCategoryTags',
      '覆写分类标签',
      '覆写指定分类的 anchorTags 数组（不是增删，是整体替换）。最多 10 个。',
      pruneArgs,
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
  ];
}

registerToolGroup({
  server: 'dogear-smart-category',
  label: '智能分类',
  create: createCategoryToolDefs,
});
