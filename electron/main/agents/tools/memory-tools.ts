/**
 * 记忆大脑 MCP Server 工具
 *
 * 三个工具：RecallMemory / SaveMemory / ForgetMemory，操作工作区级记忆
 * （<workspace>/.dogear/memory/）。SDK 自身的 auto-memory 是全局画像级别，
 * 本工具面向的是"工作区主题记忆"，两者正交。
 *
 * 使用边界：
 * - SaveMemory 仅在用户明确要求"记住 XX"时调用，不要自行猜测
 * - RecallMemory 在讨论具体主题开头主动调用，不要等用户追问
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as memoryService from '../../services/memory/memory-service.js';
import * as memoryRecall from '../../services/memory/memory-recall.js';
import { registerTools } from './tool-registry.js';

registerTools([
  {
    name: 'RecallMemory',
    description: '按关键词查询工作区级主题记忆',
    server: 'dogear-memory',
    category: 'memory',
  },
  {
    name: 'SaveMemory',
    description: '保存或更新主题记忆（仅在用户明确要求记住时使用）',
    server: 'dogear-memory',
    category: 'memory',
  },
  {
    name: 'ForgetMemory',
    description: '删除指定主题记忆',
    server: 'dogear-memory',
    category: 'memory',
  },
]);

/**
 * 创建记忆大脑 MCP Server
 * @param workspacePath 工作区绝对路径，空串时调用方不应注入此 server
 */
export function createMemoryTools(workspacePath: string) {
  return createSdkMcpServer({
    name: 'dogear-memory',
    version: '1.0.0',
    tools: [
      // ========================================
      // 工具 1: 召回主题记忆
      // ========================================
      tool(
        'RecallMemory',
        '按关键词查询与主题相关的工作区级历史记忆。每个主题记忆包含关键词索引和 markdown 正文。\n' +
        '使用时机：在讨论具体主题（股票分析、架构设计、用户偏好等）的开头主动调用，不要等用户追问历史才查。\n' +
        '匹配规则：关键词做小写归一化 + 子串匹配，不做中文分词。\n' +
        '每次最多返回 5 个主题，超出会有 hint 提示，请优化关键词再调。',
        {
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
        },
        async (args) => {
          try {
            const result = await memoryRecall.recall(
              workspacePath,
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
      tool(
        'SaveMemory',
        '保存新的主题记忆或覆盖现有主题。\n' +
        '⚠️ 仅在用户**明确表达**"记住 XX"、"把这个存到记忆里"等意图时调用，不要自行猜测。\n' +
        'slug 必须是 kebab-case（仅小写字母数字和连字符），用于文件名。\n' +
        '写错可以通过 ForgetMemory 删除，但会污染 RecallMemory 的检索结果。',
        {
          slug: z
            .string()
            .regex(/^[a-z0-9-]+$/, 'slug 必须是 kebab-case（仅小写字母数字和连字符）')
            .describe('kebab-case slug，例如 "stock-valuation"、"user-coffee-preference"'),
          title: z.string().min(1).describe('主题中文标题，例如 "股票估值偏好"'),
          keywords: z
            .array(z.string())
            .min(1)
            .describe('关键词数组，用于 RecallMemory 检索。越具体越有用'),
          content: z
            .string()
            .min(1)
            .describe('主题正文，markdown 格式，描述记忆的具体内容'),
        },
        async (args) => {
          try {
            const topic = await memoryService.upsertTopic(workspacePath, args);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `已保存主题「${topic.title}」(slug=${topic.slug})，updated=${topic.updated}`,
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
      tool(
        'ForgetMemory',
        '删除指定 slug 的主题记忆。仅在用户明确要求"忘记 XX"时使用。\n' +
        '此操作同时删除 markdown 文件和 index.json 中的条目。',
        {
          slug: z.string().describe('要删除的主题 slug'),
        },
        async (args) => {
          try {
            await memoryService.deleteTopic(workspacePath, args.slug);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `已删除主题 slug=${args.slug}`,
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
    ],
  });
}
