/**
 * 轻量 skill 加载器（阶段二 Step 2）
 *
 * 不依赖 pi-agent-core 的 AgentHarness，手写扫描 SKILL.md + frontmatter 解析。
 * 两段式：loadSkillIndex 扫描出索引（拼进 systemPrompt），createSkillTool 命中后懒加载完整 body。
 */

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { mainLogger } from '../logger.js';

export interface SkillEntry {
  name: string;
  description: string;
  dir: string;
  bodyPath: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** 极简 frontmatter 解析：只认逐行 `key: value`，够用即可，不引入 yaml 依赖 */
function parseFrontmatterFields(raw: string): Record<string, string> {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

/** 扫描每个目录下的 SKILL.md，解析出 name/description。目录或文件不存在、字段缺失均静默跳过 */
export async function loadSkillIndex(dirs: string[]): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = [];
  for (const dir of dirs) {
    const bodyPath = path.join(dir, 'SKILL.md');
    let raw: string;
    try {
      raw = await fs.readFile(bodyPath, 'utf-8');
    } catch {
      continue;
    }
    const fields = parseFrontmatterFields(raw);
    if (!fields.name || !fields.description) {
      mainLogger.warn('skill-loader: SKILL.md 缺少 name/description，已跳过', { bodyPath });
      continue;
    }
    entries.push({ name: fields.name, description: fields.description, dir, bodyPath });
  }
  return entries;
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

/** 命中索引后的懒加载工具：读取对应 SKILL.md 全文作为工具结果返回 */
export function createSkillTool(entries: SkillEntry[]): ToolDef {
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
      const body = await fs.readFile(entry.bodyPath, 'utf-8');
      return { content: [{ type: 'text', text: body }] };
    },
  );
}
