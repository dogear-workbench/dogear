/**
 * 记忆大脑 MCP Server 工具
 *
 * 主题记忆六件：dogear__RecallMemory / SaveMemory / ForgetMemory（写入带强制查重）
 * + 偏好层三件：dogear__SavePreference / ListPreferences / ForgetPreference（config/preferences.md）。
 * SaveMemory/ForgetMemory 支持 scope: 'workspace'（config/workspaces/{id}/memory/，默认）与 'global'
 * （config/memory/，跨工作区共享，准入仅限通用踩坑知识）。全局主题读侧自动合并进 recall/list。
 * SDK 自身的 auto-memory 是全局画像级别，本工具面向的是"主题记忆"，两者正交。
 *
 * 使用边界：
 * - dogear__SaveMemory 默认仅在用户明确要求"记住 XX"时调用，自动化任务场景由调用方提示词约束
 * - dogear__RecallMemory 在开始实施/调研任务前、讨论具体主题开头时主动调用，不要等用户追问
 */

import { z } from 'zod';
import * as memoryService from '../../services/memory/memory-service.js';
import * as memoryRecall from '../../services/memory/memory-recall.js';
import { isSimilarTopic } from '../../services/memory/memory-similarity.js';
import * as preferences from '../../services/memory/preferences-service.js';
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
      '开始实施/调研类任务前先查一次相关关键词（坑/决策/模式都在这里）；每次最多返回 5 个主题，超出会有 hint 提示。',
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
      '⚠️ 记忆标准严苛：只有踩过的坑（非显而易见的根因与解法）、稳定使用模式、硬决策够格；实施流水账、方案细节（dogear/plans 承载）、脑暴思路（笔记承载）不要存进来。\n' +
      "scope='global' 准入更严：仅限跨工作区复用的通用踩坑知识（如浏览器调研技巧），所有工作区的 RecallMemory 都能命中；工作区相关的记忆一律用默认 scope。\n" +
      '写入前强制查重：发现同 scope 已有相似主题时会拦截并提示（复用已有 slug 覆盖即可更新）；确认要另起新主题时，用相同参数重试并传 forceNew: true。\n' +
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
        forceNew: z
          .boolean()
          .optional()
          .describe('确认绕过相似主题查重另起新 slug 时传 true；默认 false（查重拦截）'),
      }),
      async (args) => {
        try {
          const scope = args.scope ?? 'workspace';
          const existingSameSlug = await memoryService.getTopic(workspaceId, args.slug, scope);
          if (!existingSameSlug && !args.forceNew) {
            const entries = await memoryService.listTopics(workspaceId, scope);
            const similar = entries.filter((e) =>
              isSimilarTopic(e, { slug: args.slug, title: args.title, keywords: args.keywords }),
            );
            if (similar.length > 0) {
              const listing = similar
                .map((e) => {
                  const days = Math.max(0, Math.floor((Date.now() - Date.parse(e.updated)) / 86_400_000));
                  return `  - ${e.title}（slug=${e.slug}，${days} 天前更新，scope=${e.scope}）`;
                })
                .join('\n');
              return {
                content: [
                  {
                    type: 'text' as const,
                    text:
                      `检测到同 scope 已有相似主题：\n${listing}\n` +
                      '本次未写入。要更新既有主题请改用它的 slug（覆盖写入）；确认要另起新主题时，用相同参数重试并传 forceNew: true。',
                  },
                ],
              };
            }
          }
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
          const action = existingSameSlug ? '已覆盖已有主题' : args.forceNew ? '已按 forceNew 新建主题（绕过查重）' : '已保存新主题';
          return {
            content: [
              {
                type: 'text' as const,
                text: `${action}「${topic.title}」(slug=${topic.slug}, scope=${scope})，updated=${topic.updated}`,
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
          .describe("要删除的记忆作用域，默认 'workspace'；删除全局主题时传 'global'"),
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

    // ========================================
    // 工具 4: 用户偏好层（config/preferences.md，常驻注入每个会话）
    // ========================================
    defineTool(
      'dogear__SavePreference',
      '沉淀用户工作方式偏好',
      '把用户被纠偏过的习惯、稳定的工作方式偏好写入常驻偏好层（每次会话开局注入生效，与全局规则同级）。\n' +
      '⚠️ 准入极严：一条一事、指令式（能直接指导行为）、单行一句话；仅沉淀稳定工作方式与被纠偏过的习惯，事实陈述/一次性要求/项目细节不收。\n' +
      '同主题新偏好替代旧偏好时传 replace（原文需与 ListPreferences 输出一致）；与已有偏好高度相似会被拦截。\n' +
      '条数/行数有熔断上限，写满会报错，此时需先用 dogear__ForgetPreference 清理。',
      z.object({
        content: z
          .string()
          .min(1)
          .describe('偏好内容，指令式一句话，例如「回复一律用中文」「提交前先跑 lint」'),
        replace: z
          .string()
          .optional()
          .describe('要覆盖的已有偏好原文（与 dogear__ListPreferences 输出逐字一致）；省略=新增'),
      }),
      async (args) => {
        try {
          const result = await preferences.savePreference(args.content, args.replace);
          if (result.status === 'blocked') {
            const listing = result.similarTo.map((s) => `  - ${s}`).join('\n');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `与已有偏好高度相似（疑似同主题）：\n${listing}\n本次未写入。若是更新，请传 replace=<要覆盖的原文>；若确是不同偏好，请先精简区分后再试。`,
                },
              ],
            };
          }
          const label =
            result.status === 'added' ? '已新增偏好' : result.status === 'replaced' ? '已替换偏好' : '偏好已存在，未重复写入';
          return {
            content: [
              {
                type: 'text' as const,
                text: `${label}（当前 ${result.items.length} 条）。下次会话开局生效。`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `保存偏好失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    defineTool(
      'dogear__ListPreferences',
      '查看用户偏好清单',
      '列出常驻偏好层的全部条目（每次会话开局注入生效的全局工作方式偏好）。',
      z.object({}),
      async () => {
        try {
          const items = await preferences.listPreferences();
          if (items.length === 0) {
            return {
              content: [
                { type: 'text' as const, text: `偏好层为空（0/${preferences.PREF_MAX_ITEMS} 条）。` },
              ],
            };
          }
          const listing = items.map((s, i) => `${i + 1}. ${s}`).join('\n');
          return {
            content: [
              {
                type: 'text' as const,
                text: `用户偏好（${items.length}/${preferences.PREF_MAX_ITEMS} 条）：\n${listing}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `读取偏好失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
      { replay: 'safe' },
    ),

    defineTool(
      'dogear__ForgetPreference',
      '删除用户偏好',
      '删除常驻偏好层的一条偏好。content 必须与 dogear__ListPreferences 输出的原文逐字一致。',
      z.object({
        content: z.string().min(1).describe('要删除的偏好原文（与 dogear__ListPreferences 输出一致）'),
      }),
      async (args) => {
        try {
          const items = await preferences.forgetPreference(args.content);
          return {
            content: [
              {
                type: 'text' as const,
                text: `已删除偏好（剩余 ${items.length} 条）。下次会话开局生效。`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `删除偏好失败: ${error instanceof Error ? error.message : String(error)}`,
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
