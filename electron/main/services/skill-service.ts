/**
 * Skill 管理服务
 *
 * 职责：
 * - 扫描两个来源目录的 SKILL.md：
 *   - builtin：resources/skill-templates/<name>/SKILL.md（只读模板源）
 *   - custom：.dogear/custom/skills/<name>/SKILL.md（全局统一自定义区，与工作区无关）
 * - 列出所有 skill 并标注 source + enabled（经工作区 config 的 enabledSkills 数组控制，写入方在能力页 skill 子开关）
 * - 自定义技能管理：读全文、编辑写回、整目录导入（frontmatter 校验 + 全局重名检测）
 */

import { existsSync } from 'fs';
import path from 'path';
import fs from 'fs/promises';
import { getTemplatesDir } from './skill-template-service.js';
import { getConfigDir } from './settings-service.js';
import { getWorkspaceConfig } from './workspace-config-service.js';

export type SkillSource = 'builtin' | 'custom';

export interface SkillEntry {
  source: SkillSource;
  name: string;
  description?: string;
  dir: string;
  filePath: string;
  enabled: boolean;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
const MAX_SKILL_NAME_LENGTH = 64;

export function isValidSkillName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_SKILL_NAME_LENGTH &&
    /^[a-z0-9-]+$/.test(name) &&
    !name.startsWith('-') &&
    !name.endsWith('-') &&
    !name.includes('--')
  );
}

export function customSkillsDir(configDir: string): string {
  return path.join(configDir, 'custom', 'skills');
}

function skillNameInvalidError(name: string): string {
  return `技能名「${name}」不合法：仅限小写字母、数字和连字符，不以连字符开头或结尾，不含连续连字符，长度不超过 ${MAX_SKILL_NAME_LENGTH}`;
}

function validateFrontmatter(content: string, fallbackName: string): { name: string; error?: string } {
  if (!FRONTMATTER_RE.test(content)) {
    return { name: '', error: '缺少 frontmatter：文件需以 --- 块开头，声明 name 与 description' };
  }
  const name = parseFrontmatter(content).name || fallbackName;
  if (!isValidSkillName(name)) return { name: '', error: skillNameInvalidError(name) };
  return { name };
}

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
 * 列出所有 Skill（builtin + custom），用工作区 config 的 enabledSkills 标注 enabled。
 */
export async function listSkills(workspaceId: string | null | undefined): Promise<SkillEntry[]> {
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

  const customEntries = await scanSkillsDir(customSkillsDir(getConfigDir()), 'custom');
  for (const entry of customEntries) {
    entry.enabled = enabledSkillsSet.has(entry.name);
  }
  result.push(...customEntries);

  return result;
}

interface SkillOwner {
  source: SkillSource;
  dir: string;
}

async function collectSkillOwners(builtinDir: string, skillsDir: string): Promise<Map<string, SkillOwner>> {
  const [builtin, custom] = await Promise.all([
    scanSkillsDir(builtinDir, 'builtin'),
    scanSkillsDir(skillsDir, 'custom'),
  ]);
  const owners = new Map<string, SkillOwner>();
  for (const entry of [...builtin, ...custom]) {
    if (!owners.has(entry.name)) owners.set(entry.name, { source: entry.source, dir: entry.dir });
  }
  return owners;
}

async function resolveCustomSkillDir(skillsDir: string, name: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const dir = path.join(skillsDir, entry);
    try {
      if (!(await fs.stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    const meta = await readSkillMeta(dir);
    if (meta && (meta.name ?? entry) === name) return dir;
  }
  return null;
}

export interface CustomSkillReadResult {
  content?: string;
  error?: string;
}

export interface CustomSkillWriteResult {
  error?: string;
}

export interface CustomSkillImportResult {
  error?: string;
  conflict?: boolean;
  name?: string;
}

export async function readCustomSkill(name: string, skillsDir: string): Promise<CustomSkillReadResult> {
  try {
    const dir = await resolveCustomSkillDir(skillsDir, name);
    if (!dir) return { error: `未找到自定义技能「${name}」` };
    const content = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf-8');
    return { content };
  } catch (error) {
    console.error('读取自定义技能失败:', error);
    return { error: String(error) };
  }
}

export async function writeCustomSkill(
  name: string,
  content: string,
  dirs: { skillsDir: string; builtinDir: string },
): Promise<CustomSkillWriteResult> {
  try {
    const selfDir = await resolveCustomSkillDir(dirs.skillsDir, name);
    if (!selfDir) return { error: `未找到自定义技能「${name}」` };
    const checked = validateFrontmatter(content, path.basename(selfDir));
    if (checked.error) return { error: checked.error };
    const nextName = checked.name;
    if (nextName !== name) {
      const owners = await collectSkillOwners(dirs.builtinDir, dirs.skillsDir);
      for (const [existing, owner] of owners) {
        if (owner.dir === selfDir) owners.delete(existing);
      }
      const owner = owners.get(nextName);
      if (owner) {
        return { error: `技能名「${nextName}」已被${owner.source === 'builtin' ? '内置' : '自定义'}技能占用` };
      }
    }
    await fs.writeFile(path.join(selfDir, 'SKILL.md'), content, 'utf-8');
    return {};
  } catch (error) {
    console.error('保存自定义技能失败:', error);
    return { error: String(error) };
  }
}

/** 拼装 SKILL.md 全文：frontmatter name/description 由参数生成，description 压平换行保证单行键值可解析 */
function renderSkillMarkdown(name: string, description: string, content: string): string {
  const desc = description.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${content.trim()}\n`;
}

/**
 * 覆盖式保存自定义 skill（新建或更新）：
 * 已存在（按 frontmatter name 解析命中）→ 复用 writeCustomSkill 的 frontmatter 校验写回；
 * 不存在 → builtin/全局重名检测 + 目录名撞车防护（目录存在但承载着别的技能名时禁止覆盖）后建目录写入。
 */
export async function saveCustomSkill(
  name: string,
  description: string,
  content: string,
  dirs: { skillsDir: string; builtinDir: string },
): Promise<CustomSkillWriteResult> {
  try {
    if (!isValidSkillName(name)) return { error: skillNameInvalidError(name) };
    const full = renderSkillMarkdown(name, description, content);
    if (await resolveCustomSkillDir(dirs.skillsDir, name)) {
      return writeCustomSkill(name, full, dirs);
    }
    const meta = await readSkillMeta(path.join(dirs.skillsDir, name));
    if (meta && (meta.name ?? name) !== name) {
      return { error: `目录「${name}」实际承载技能「${meta.name}」（frontmatter name 与目录名不一致），禁止覆盖，请先在设置页处理` };
    }
    const owners = await collectSkillOwners(dirs.builtinDir, dirs.skillsDir);
    const owner = owners.get(name);
    if (owner) {
      return { error: `技能名「${name}」已被${owner.source === 'builtin' ? '内置' : '自定义'}技能占用` };
    }
    const selfDir = path.join(dirs.skillsDir, name);
    await fs.mkdir(selfDir, { recursive: true });
    await fs.writeFile(path.join(selfDir, 'SKILL.md'), full, 'utf-8');
    return {};
  } catch (error) {
    console.error('保存自定义技能失败:', error);
    return { error: String(error) };
  }
}

/** 删除自定义 skill（整目录移除；按 name 解析仅限自定义区，builtin 无删除路径） */
export async function deleteCustomSkill(name: string, skillsDir: string): Promise<CustomSkillWriteResult> {
  try {
    const dir = await resolveCustomSkillDir(skillsDir, name);
    if (!dir) return { error: `未找到自定义技能「${name}」` };
    await fs.rm(dir, { recursive: true, force: true });
    return {};
  } catch (error) {
    console.error('删除自定义技能失败:', error);
    return { error: String(error) };
  }
}

export async function importCustomSkill(
  srcDir: string,
  dirs: { skillsDir: string; builtinDir: string },
  overwrite: boolean,
): Promise<CustomSkillImportResult> {
  try {
    let srcStat: { isDirectory: () => boolean };
    try {
      srcStat = await fs.stat(srcDir);
    } catch {
      return { error: '所选目录不存在' };
    }
    if (!srcStat.isDirectory()) return { error: '所选路径不是目录' };

    let content: string;
    try {
      content = await fs.readFile(path.join(srcDir, 'SKILL.md'), 'utf-8');
    } catch {
      return { error: '所选目录缺少 SKILL.md' };
    }
    const dirName = path.basename(srcDir);
    const checked = validateFrontmatter(content, dirName);
    if (checked.error) return { error: checked.error };
    const name = checked.name;

    const destDir = path.join(dirs.skillsDir, dirName);
    const rel = path.relative(path.resolve(srcDir), path.resolve(destDir));
    if (rel === '') return { name };

    const owners = await collectSkillOwners(dirs.builtinDir, dirs.skillsDir);
    const owner = owners.get(name);
    if (owner) {
      return { error: `技能名「${name}」已被${owner.source === 'builtin' ? '内置' : '自定义'}技能占用` };
    }

    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return { error: '所选目录包含导入目标，无法复制' };
    }
    if (existsSync(destDir)) {
      if (!overwrite) return { conflict: true, name };
      await fs.rm(destDir, { recursive: true, force: true });
    }
    await fs.mkdir(dirs.skillsDir, { recursive: true });
    await fs.cp(srcDir, destDir, { recursive: true, dereference: false });
    return { name };
  } catch (error) {
    console.error('导入自定义技能失败:', error);
    return { error: String(error) };
  }
}
