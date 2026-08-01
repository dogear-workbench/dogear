/**
 * 薄封装 pi-agent-core 的 loadSkills + formatSkillInvocation（阶段二 Step 1）
 *
 * 替换原手写 frontmatter 解析 + 自造索引文本 + 自造 Skill 工具。
 * 对外签名保持不变（loadSkillIndex / formatSkillIndexForPrompt / createSkillTool），
 * 内部白嫖 loadSkills 的递归扫描 / .gitignore / yaml 解析 / name 校验 / 错误诊断聚合。
 */
import path from 'path';
import fs from 'fs/promises';
import { z } from 'zod';
import {
  loadSkills,
  formatSkillInvocation,
  type ExecutionEnv,
  type Skill,
  type SkillDiagnostic,
} from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { defineTool } from '../pi/tool-adapter.js';
import { mainLogger } from '../logger.js';

export interface SkillEntry {
  name: string;
  description: string;
  dir: string;
  bodyPath: string;
  /** loadSkills 已读入的 SKILL.md 正文缓存，createSkillTool 命中时直接用，避免再 fs.readFile */
  content?: string;
}

function entryFromSkill(skill: Skill): SkillEntry {
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
 * 扫描给定目录下的 SKILL.md，委托给 pi-agent-core loadSkills（递归 + .gitignore + yaml 解析 + name 校验）。
 * env 缺省用 NodeExecutionEnv(process.cwd())；调用方传 WorkspaceExecutionEnv 能让 .gitignore 用工作区相对路径正确解析。
 */
export async function loadSkillIndex(dirs: string[], env?: ExecutionEnv): Promise<SkillEntry[]> {
  const executionEnv = env ?? new NodeExecutionEnv({ cwd: process.cwd() });
  const { skills, diagnostics } = await loadSkills(executionEnv, dirs);
  logDiagnostics(diagnostics);
  return skills.map(entryFromSkill);
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

/** 命中索引后的懒加载工具：优先用 entry.content（loadSkills 已读），缺失再 fs.readFile 兜底；输出走 formatSkillInvocation 包 <skill> 块 */
export function createSkillTool(entries: SkillEntry[]) {
  return defineTool(
    'Skill',
    '加载指定 skill 的完整指引内容（SKILL.md 全文）。name 必须是 <available_skills> 索引中列出的 skill 名称。',
    z.object({ name: z.string().describe('skill 名称，如 article-parser / cross-session-review') }),
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
      const skill: Skill = {
        name: entry.name,
        description: entry.description,
        content,
        filePath: entry.bodyPath,
      };
      return { content: [{ type: 'text', text: formatSkillInvocation(skill) }] };
    },
  );
}
