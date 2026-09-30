/**
 * 记忆大脑 MCP Server 工具
 *
 * 默认三个工具：dogear__RecallMemory / dogear__SaveMemory / dogear__ForgetMemory，操作主题记忆。
 * SaveMemory/ForgetMemory 支持 scope: 'workspace'（config/workspaces/{id}/memory/，默认）与 'global'
 * （config/memory/，跨工作区共享，准入仅限通用踩坑知识）。全局主题读侧自动合并进 recall/list。
 * SDK 自身的 auto-memory 是全局画像级别，本工具面向的是"主题记忆"，两者正交。
 *
 * 使用边界：
 * - dogear__SaveMemory 默认仅在用户明确要求"记住 XX"时调用，自动化任务场景由调用方提示词约束
 * - dogear__RecallMemory 在讨论具体主题开头主动调用，不要等用户追问
 */

import { z } from 'zod';
import * as memoryService from '../../services/memory/memory-service.js';
import * as memoryRecall from '../../services/memory/memory-recall.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

export function createMemoryToolDefs(workspaceId: string): ToolDef[] {
  const defs: ToolDef[] = [
    // ========================================
    // 工具 1: 召回主题记忆
    // ========================================
    defineTool(
      'dogear__RecallMemory',
      '按关键词查询历史记忆',
      '按关键词查询与主题相关的历史记忆，结果合并工作区记忆与全局记忆（scope=global，跨工作区共享）。每个主题记忆包含关键词索引和 markdown 正文。\n' +
      '匹配规则：关键词做小写归一化 + 子串匹配，不做中文分词。\n' +
      '每次最多返回 5 个主题，超出会有 hint 提示。',
      z.object({
        keywords: z
          .array(z.string())
          .min(1)
          .describe('关键词数组，会做小写 + 子串匹配。例如 ["股票", "估值"]'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('返回主题数上限，默认 3，最大 5'),
      }),
      async (args) => {
        try {
          const result = await memoryRecall.recall(
            workspaceId,
            args.keywords,
            args.limit ?? 3,
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `召回记忆失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // ========================================
    // 工具 2: 保存主题记忆
    // ========================================
    defineTool(
      'dogear__SaveMemory',
      '保存主题记忆',
      '保存新的主题记忆或覆盖现有主题。\n' +
      'slug 必须是 kebab-case（仅小写字母数字和连字符），用于文件名。\n' +
      '⚠️ 记忆标准严苛：只有踩过的坑（非显而易见的根因与解法）、稳定使用模式、硬决策够格；实施流水账、方案细节（docs/plans 承载）、脑暴思路（笔记承载）不要存进来。\n' +
      "scope='global' 准入更严：仅限跨工作区复用的通用踩坑知识（如浏览器调研技巧），所有工作区的 RecallMemory 都能命中；工作区相关的记忆一律用默认 scope。\n" +
      '写错可以通过 dogear__ForgetMemory 删除，但会污染 dogear__RecallMemory 的检索结果。',
      z.object({
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/, 'slug 必须是 kebab-case（仅小写字母数字和连字符）')
          .describe('kebab-case slug，例如 "stock-valuation"、"user-coffee-preference"'),
        title: z.string().min(1).describe('主题中文标题，例如 "股票估值偏好"'),
        keywords: z
          .array(z.string())
          .min(1)
          .describe('关键词数组，用于 dogear__RecallMemory 检索。越具体越有用'),
        content: z
          .string()
          .min(1)
          .describe('主题正文，markdown 格式，描述记忆的具体内容'),
        scope: z
          .enum(['workspace', 'global'])
          .optional()
          .describe(
            "存储作用域，默认 'workspace'。'global' 仅限跨工作区复用的通用踩坑知识（全局主题在所有工作区的 RecallMemory 中可见）"
          ),
      }),
      async (args) => {
        try {
          const scope = args.scope ?? 'workspace';
          const topic = await memoryService.upsertTopic(
            workspaceId,
            {
              slug: args.slug,
              title: args.title,
              keywords: args.keywords,
              content: args.content,
            },
            scope
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: `已保存主题「${topic.title}」(slug=${topic.slug}, scope=${scope})，updated=${topic.updated}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `保存记忆失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // ========================================
    // 工具 3: 删除主题记忆
    // ========================================
    defineTool(
      'dogear__ForgetMemory',
      '删除主题记忆',
      '删除指定 slug 的主题记忆。\n' +
      "此操作同时删除 markdown 文件和 index.json 中的条目。默认删工作区记忆；删除全局主题时传 scope='global'。",
      z.object({
        slug: z.string().describe('要删除的主题 slug'),
        scope: z
          .enum(['workspace', 'global'])
          .optional()
          .describe("要删除的记忆作用域，默认 'workspace'；删除全局主题（如 browser-playbook）时传 'global'"),
      }),
      async (args) => {
        try {
          const scope = args.scope ?? 'workspace';
          await memoryService.deleteTopic(workspaceId, args.slug, scope);
          return {
            content: [
              {
                type: 'text' as const,
                text: `已删除主题 slug=${args.slug}, scope=${scope}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `删除记忆失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),
  ];

  return defs;
}

registerToolGroup({
  server: 'dogear-memory',
  label: '记忆系统',
  create: createMemoryToolDefs,
  placeholder: [''],
});
