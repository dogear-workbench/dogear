/**
 * Skill 管理服务
 *
 * 职责：
 * - 扫描三个来源目录的 SKILL.md：
 *   - builtin：resources/skill-templates/<name>/SKILL.md（只读模板源）
 *   - custom：.dogear/skills/<name>/SKILL.md（全局目录，与工作区无关）
 *   - user：~/.claude/skills/<name>/SKILL.md
 * - 列出所有 skill 并标注 source + enabled（经工作区 config 的 enabledSkills 数组控制，写入方在能力页 skill 细开关）
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { getTemplatesDir } from './skill-template-service.js';
import { getConfigDir } from './settings-service.js';
import { getWorkspaceConfig } from './workspace-config-service.js';

export type SkillSource = 'builtin' | 'custom' | 'user';

export interface SkillEntry {
  source: SkillSource;
  name: string;
  description?: string;
  dir: string;
  filePath: string;
  enabled: boolean;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};
  const block = match[1];
  const result: { name?: string; description?: string } = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^(name|description)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[m[1] as 'name' | 'description'] = value;
  }
  return result;
}

async function readSkillMeta(dir: string): Promise<{ name?: string; description?: string; filePath: string } | null> {
  const skillPath = path.join(dir, 'SKILL.md');
  try {
    const content = await fs.readFile(skillPath, 'utf-8');
    const meta = parseFrontmatter(content);
    return {
      name: meta.name,
      description: meta.description,
      filePath: skillPath,
    };
  } catch {
    return null;
  }
}

async function scanSkillsDir(rootDir: string, source: SkillSource): Promise<SkillEntry[]> {
  const result: SkillEntry[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch {
    return result;
  }

  for (const name of entries) {
    const dir = path.join(rootDir, name);
    let stat: { isDirectory: () => boolean };
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const meta = await readSkillMeta(dir);
    if (!meta) continue;

    result.push({
      source,
      name: meta.name ?? name,
      description: meta.description,
      dir,
      filePath: meta.filePath,
      enabled: false,
    });
  }

  return result;
}

/**
 * 列出所有 Skill（builtin + custom + user），用工作区 config 的 enabledSkills 标注 enabled。
 */export async function listSkills(workspaceId: string | null | undefined): Promise<SkillEntry[]> {
  const result: SkillEntry[] = [];

  const enabledSkillsSet = new Set<string>(
    workspaceId ? (await getWorkspaceConfig(workspaceId)).enabledSkills : [],
  );

  const builtinSkillsDir = getTemplatesDir();
  const builtinEntries = await scanSkillsDir(builtinSkillsDir, 'builtin');
  for (const entry of builtinEntries) {
    entry.enabled = enabledSkillsSet.has(entry.name);
  }
  result.push(...builtinEntries);

  const customSkillsDir = path.join(getConfigDir(), 'skills');
  const customEntries = await scanSkillsDir(customSkillsDir, 'custom');
  for (const entry of customEntries) {
    entry.enabled = enabledSkillsSet.has(entry.name);
  }
  result.push(...customEntries);

  const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
  const userEntries = await scanSkillsDir(userSkillsDir, 'user');
  for (const entry of userEntries) {
    entry.enabled = enabledSkillsSet.has(entry.name);
  }
  result.push(...userEntries);

  return result;
}
