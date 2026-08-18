/**
 * 记忆大脑 MCP Server 工具
 *
 * 默认三个工具：dogear__RecallMemory / dogear__SaveMemory / dogear__ForgetMemory，操作工作区级记忆
 * （<workspace>/.dogear/memory/）。SDK 自身的 auto-memory 是全局画像级别，
 * 本工具面向的是"工作区主题记忆"，两者正交。
 *
 * autonomous 模式（opts.autonomous=true）：
 * - dogear__SaveMemory 描述改为自动化任务契约（"仅用户明确要求"仅适用于交互式聊天）
 * - 额外注册 dogear__GetCoreProfile / dogear__UpdateCoreProfile 两个工具（供复盘任务维护稳定身份画像）
 *
 * 使用边界：
 * - dogear__SaveMemory 默认仅在用户明确要求"记住 XX"时调用，autonomous 模式下改为按调用方提示词判断
 * - dogear__RecallMemory 在讨论具体主题开头主动调用，不要等用户追问
 * - dogear__UpdateCoreProfile 是全量覆盖，调用前必须先 dogear__GetCoreProfile 合并
 */

import { z } from 'zod';
import * as memoryService from '../../services/memory/memory-service.js';
import * as memoryRecall from '../../services/memory/memory-recall.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

export function createMemoryToolDefs(workspacePath: string, opts?: { autonomous?: boolean }): ToolDef[] {
  const autonomous = opts?.autonomous === true;


  const defs: ToolDef[] = [
    // ========================================
    // 工具 1: 召回主题记忆
    // ========================================
    defineTool(
      'dogear__RecallMemory',
      '按关键词查询历史记忆',
      '按关键词查询与主题相关的工作区级历史记忆。每个主题记忆包含关键词索引和 markdown 正文。\n' +
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
    defineTool(
      'dogear__SaveMemory',
      '保存主题记忆',
      '保存新的主题记忆或覆盖现有主题。\n' +
      'slug 必须是 kebab-case（仅小写字母数字和连字符），用于文件名。\n' +
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
      }),
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
    defineTool(
      'dogear__ForgetMemory',
      '删除主题记忆',
      '删除指定 slug 的主题记忆。\n' +
      '此操作同时删除 markdown 文件和 index.json 中的条目。',
      z.object({
        slug: z.string().describe('要删除的主题 slug'),
      }),
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
  ];

  if (autonomous) {
    defs.push(
      // ========================================
      // 工具 4（仅 autonomous）: 读取核心画像
      // ========================================
      defineTool(
        'dogear__GetCoreProfile',
        '读取核心画像',
        '读取本工作区的 core-profile（每个新会话自动注入的稳定身份画像）。\n' +
        '返回当前正文和 updated 时间戳；文件不存在或为空时返回明确提示。\n' +
        'dogear__UpdateCoreProfile 是全量覆盖，调用前应先调本工具拿现状再合并。',
        z.object({}),
        async () => {
          try {
            const profile = await memoryService.getCoreProfile(workspacePath);
            if (!profile || !profile.content.trim()) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: '（当前 core-profile 为空，是正常状态；不代表没必要写，只是目前没有足够稳定跨会话的信号）',
                  },
                ],
              };
            }
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `updated：${profile.updated}\n\n${profile.content}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `读取 core-profile 失败: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),

      // ========================================
      // 工具 5（仅 autonomous）: 更新核心画像
      // ========================================
      defineTool(
        'dogear__UpdateCoreProfile',
        '更新核心画像',
        '全量覆盖写入 core-profile。\n' +
        '⚠️ 是**全量覆盖**：必须先 dogear__GetCoreProfile 拿现有内容，把新增部分与之合并成完整版本再传入，否则会丢失已有内容。\n' +
        '写入成功后 updated 时间戳自动刷新。',
        z.object({
          content: z
            .string()
            .min(1)
            .describe('合并后的完整 core-profile 正文（markdown）；不带 frontmatter，工具会自动加'),
        }),
        async (args) => {
          try {
            await memoryService.updateCoreProfile(workspacePath, args.content);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '已更新 core-profile（全量覆盖）',
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `更新 core-profile 失败: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),
    );
  }

  return defs;
}

registerToolGroup({
  server: 'dogear-memory',
  label: '记忆系统',
  create: createMemoryToolDefs,
  placeholder: [''],
});
