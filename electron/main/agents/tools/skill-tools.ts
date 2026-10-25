/**
 * 自定义 Skill 管理工具组
 *
 * 四工具：dogear__SaveSkill / dogear__GetSkill / dogear__ListCustomSkills / dogear__ForgetSkill，
 * 操作全局自定义区 custom/skills/<name>/SKILL.md（跨工作区，与工作区绑定无关）。
 * frontmatter 校验与全局重名检测由服务层 skill-service 承担，本层不自造第二套。
 *
 * 使用边界：
 * - SaveSkill 仅在用户明确要求沉淀 skill、或会话实践中反复验证的稳定流程值得固化时调用；
 *   一次性方案细节走计划文档/笔记卡片，不存 skill
 * - 新建 skill 默认未启用（enabled=false），需用户在能力页开启后才进新会话的 skill 索引
 */

import { z } from 'zod';
import * as skillService from '../../services/skill-service.js';
import { getTemplatesDir } from '../../services/skill-template-service.js';
import { getConfigDir } from '../../services/settings-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function skillDirs(): { skillsDir: string; builtinDir: string } {
  return {
    skillsDir: skillService.customSkillsDir(getConfigDir()),
    builtinDir: getTemplatesDir(),
  };
}

export function createSkillToolDefs(workspaceId: string | null | undefined): ToolDef[] {
  const defs: ToolDef[] = [
    // ========================================
    // 工具 1: 保存自定义 skill
    // ========================================
    defineTool(
      'dogear__SaveSkill',
      '保存自定义 skill',
      '创建或覆盖自定义 skill，保存到全局自定义区（跨工作区生效）。\n' +
      'name 必须是 kebab-case（小写字母数字连字符）；description 是一句话用途说明（进 skill 索引供模型判断何时加载）；content 是 SKILL.md 正文 markdown，不含 frontmatter（name/description 由本工具生成）。\n' +
      '⚠️ 仅在用户明确要求沉淀 skill、或会话实践中反复验证的稳定流程值得固化时调用；一次性方案细节走计划文档/笔记承载，不要存成 skill。\n' +
      '注意：新建的 skill 默认未启用，需用户在设置-能力页开启后才进新会话的 skill 索引；运行中会话不会热更新。',
      z.object({
        name: z
          .string()
          .regex(SKILL_NAME_PATTERN, 'name 必须是 kebab-case（小写字母数字连字符，不以下划线/连字符开头结尾、无连续连字符）')
          .max(64)
          .describe('skill 名，kebab-case，例如 "api-debugging"、"weekly-report-flow"'),
        description: z
          .string()
          .min(1)
          .max(500)
          .describe('一句话用途说明，展示在 skill 索引中，写清什么任务该加载它'),
        content: z
          .string()
          .min(1)
          .describe('SKILL.md 正文 markdown（不含 frontmatter），通常是完整的方法论/流程指引'),
      }),
      async (args) => {
        try {
          const result = await skillService.saveCustomSkill(
            args.name,
            args.description,
            args.content,
            skillDirs(),
          );
          if (result.error) {
            return {
              content: [{ type: 'text' as const, text: result.error }],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `已保存自定义 skill「${args.name}」。注意：新 skill 默认未启用，需在设置-能力页开启后才进新会话的 skill 索引；运行中会话需重启才会感知变更。`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `保存 skill 失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // ========================================
    // 工具 2: 读取自定义 skill 全文
    // ========================================
    defineTool(
      'dogear__GetSkill',
      '读取自定义 skill 全文',
      '读取指定自定义 skill 的 SKILL.md 全文（含 frontmatter）。builtin skill 不走此工具——已有 Skill 工具按名懒加载全文。',
      z.object({
        name: z.string().min(1).describe('要读取的自定义 skill 名'),
      }),
      async (args) => {
        try {
          const result = await skillService.readCustomSkill(
            args.name,
            skillService.customSkillsDir(getConfigDir()),
          );
          if (result.error || result.content === undefined) {
            return {
              content: [{ type: 'text' as const, text: result.error ?? '读取失败' }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text' as const, text: result.content }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `读取 skill 失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // ========================================
    // 工具 3: 列出自定义 skill
    // ========================================
    defineTool(
      'dogear__ListCustomSkills',
      '列出自定义 skill',
      '列出全部自定义 skill（name + description + enabled 状态）。enabled 来自当前工作区能力页的开启状态，false 表示未进该工作区会话的 skill 索引；builtin skill 清单已在系统提示词 skill 索引中，不在此列。',
      z.object({}),
      async () => {
        try {
          const entries = await skillService.listSkills(workspaceId);
          const custom = entries
            .filter((e) => e.source === 'custom')
            .map((e) => ({ name: e.name, description: e.description ?? '', enabled: e.enabled }));
          const text = custom.length === 0
            ? '暂无自定义 skill（用 dogear__SaveSkill 创建第一个）'
            : JSON.stringify(custom, null, 2);
          return {
            content: [{ type: 'text' as const, text }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `列出自定义 skill 失败: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // ========================================
    // 工具 4: 删除自定义 skill
    // ========================================
    defineTool(
      'dogear__ForgetSkill',
      '删除自定义 skill',
      '删除指定自定义 skill（整目录移除，仅限自定义区；builtin 不可删）。name 不存在时返回错误。删除后运行中会话的 skill 索引不会热更新。',
      z.object({
        name: z.string().min(1).describe('要删除的自定义 skill 名'),
      }),
      async (args) => {
        try {
          const result = await skillService.deleteCustomSkill(
            args.name,
            skillService.customSkillsDir(getConfigDir()),
          );
          if (result.error) {
            return {
              content: [{ type: 'text' as const, text: result.error }],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `已删除自定义 skill「${args.name}」（运行中会话需重启才会感知变更）`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `删除 skill 失败: ${error instanceof Error ? error.message : String(error)}`,
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
  server: 'dogear-skill',
  label: '自定义 Skill 管理',
  create: createSkillToolDefs,
  placeholder: [''],
});
