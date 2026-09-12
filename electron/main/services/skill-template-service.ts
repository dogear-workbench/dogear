/**
 * 通用 Skill 模板服务
 *
 * 模板源统一存放在 resources/skill-templates/<name>/SKILL.md（开发时读源文件，
 * 构建时 electron-builder 打包到 process.resourcesPath/skill-templates/）。
 * pi-session 直接从模板源扫描 builtin skill，不再复制到工作区目录。
 */

import path from 'path';
import fs from 'fs/promises';
import electron from 'electron';

const { app } = electron;

export interface SkillTemplateMeta {
  name: string;
  /** SKILL.md 首行 # 标题；无标题时为 undefined */
  title?: string;
  description: string;
}

export function getTemplatesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'skill-templates');
  }
  return path.join(process.cwd(), 'resources', 'skill-templates');
}

function parseTitle(content: string): string | undefined {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const heading = body.match(/^#\s+(.+?)\s*$/m);
  return heading?.[1] || undefined;
}

function parseDescription(content: string): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return '';
  const descLine = fmMatch[1]
    .split(/\r?\n/)
    .find((l) => l.startsWith('description:'));
  if (!descLine) return '';
  return descLine.slice('description:'.length).trim();
}

export async function listSkillTemplates(): Promise<SkillTemplateMeta[]> {
  const dir = getTemplatesDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const result: SkillTemplateMeta[] = [];
  for (const name of entries) {
    const skillPath = path.join(dir, name, 'SKILL.md');
    try {
      const content = await fs.readFile(skillPath, 'utf-8');
      result.push({ name, title: parseTitle(content), description: parseDescription(content) });
    } catch {
      // 不是有效模板目录，跳过
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTemplateContent(name: string): Promise<string> {
  const skillPath = path.join(getTemplatesDir(), name, 'SKILL.md');
  return fs.readFile(skillPath, 'utf-8');
}
