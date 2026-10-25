/**
 * skill 索引与 Skill 工具装配
 *
 * 扫描与格式化实现在 skill-scanner.ts（对齐 pi-agent-core 0.99.2 的发现规则与输出格式，
 * 升级 1.x 时不再依赖其 skills API）。对外签名保持不变（loadSkillIndex / loadAllSkillEntries /
 * formatSkillIndexForPrompt / createSkillTool）。
 */
import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';
import { formatSkillInvocation, scanSkillDirs, type SkillDiagnostic, type SkillInfo } from './skill-scanner.js';
import { defineTool } from '../pi/tool-adapter.js';
import { mainLogger } from '../logger.js';
import { getConfigDir } from '../../services/settings-service.js';
import { getTemplatesDir } from '../../services/skill-template-service.js';

export interface SkillEntry {
  name: string;
  description: string;
  dir: string;
  bodyPath: string;
  /** 扫描时已读入的 SKILL.md 正文缓存，createSkillTool 命中时直接用，避免再 fs.readFile */
  content?: string;
}

function entryFromSkill(skill: SkillInfo): SkillEntry {
  return {
    name: skill.name,
    description: skill.description,
    dir: path.dirname(skill.filePath),
    bodyPath: skill.filePath,
    content: skill.content,
  };
}

function logDiagnostics(diagnostics: SkillDiagnostic[]): void {
  for (const d of diagnostics) {
    mainLogger.warn('skill-loader diagnostic', { code: d.code, path: d.path, message: d.message });
  }
}

/**
 * 扫描给定目录下的 SKILL.md（递归 + .gitignore + yaml 解析 + name 校验，目录含 SKILL.md 即 skill root 不再递归）。
 * 诊断走 mainLogger.warn；缺失目录静默跳过。
 */
export async function loadSkillIndex(dirs: string[]): Promise<SkillEntry[]> {
  const { skills, diagnostics } = await scanSkillDirs(dirs);
  logDiagnostics(diagnostics);
  return skills.map(entryFromSkill);
}

/** 会话装配（pi-session）、定时任务 sanitize 与 SKILL.md 拼接共用的两目录 skill 索引 */
export async function loadAllSkillEntries(): Promise<SkillEntry[]> {
  return loadSkillIndex([
    getTemplatesDir(),
    path.join(getConfigDir(), 'custom', 'skills'),
  ]);
}

/** 拼成 <available_skills> 索引文本塞进 systemPrompt；无 skill 时返回空串 */
export function formatSkillIndexForPrompt(entries: SkillEntry[]): string {
  if (entries.length === 0) return '';
  const lines = [
    '以下 skill 提供特定任务的专项指引。当任务匹配某个 skill 的 description 时，先调用 Skill 工具（参数 name）加载完整内容，再按其指引行动。',
    '',
    '<available_skills>',
  ];
  for (const entry of entries) {
    lines.push('  <skill>');
    lines.push(`    <name>${entry.name}</name>`);
    lines.push(`    <description>${entry.description}</description>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

/**
 * 命中索引后的懒加载工具：优先用 entry.content（扫描已读），缺失再 fs.readFile 兜底；输出走 formatSkillInvocation 包 <skill> 块。
 * skillLinkedTools（skillName→配套工具名，仅主会话装配传入）：命中且有映射时返回 control.addTools 请求挂载配套工具。
 */
export function createSkillTool(entries: SkillEntry[], skillLinkedTools?: Record<string, string[]>) {
  return defineTool(
    'Skill',
    '加载 skill 指引全文',
    '加载指定 skill 的完整指引内容（SKILL.md 全文）。name 必须是 <available_skills> 索引中列出的 skill 名称。若该 skill 配套领域工具，加载时这些工具会一并就位，无需另行搜索。',
    z.object({ name: z.string().describe('skill 名称，如 article-parser / brainstorming') }),
    async ({ name }) => {
      const entry = entries.find((e) => e.name === name);
      if (!entry) {
        return {
          content: [{
            type: 'text',
            text: `未找到名为 "${name}" 的 skill，可用列表：${entries.map((e) => e.name).join(', ') || '(空)'}`,
          }],
          isError: true,
        };
      }
      mainLogger.info('Skill 工具命中:', { name });
      const content = entry.content ?? await fs.readFile(entry.bodyPath, 'utf-8');
      const skill: SkillInfo = {
        name: entry.name,
        description: entry.description,
        content,
        filePath: entry.bodyPath,
      };
      const linkedTools = skillLinkedTools?.[name];
      return {
        content: [{ type: 'text', text: formatSkillInvocation(skill) }],
        ...(linkedTools?.length ? { control: { addTools: linkedTools } } : {}),
      };
    },
  );
}
