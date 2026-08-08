/**
 * 通用 Skill 模板服务
 *
 * 模板源统一存放在 resources/skill-templates/<name>/SKILL.md（开发时读源文件，
 * 构建时 electron-builder 打包到 process.resourcesPath/skill-templates/）。
 * 所有内置模板走订阅模式：用户在设置页订阅时复制到工作区 .claude/skills/<name>/，
 * 之后由 SDK settingSources=['project'] 自动加载，副本可任意编辑，恢复按钮强制覆盖回模板源。
 */

import path from 'path';
import fs from 'fs/promises';
import electron from 'electron';

const { app } = electron;

export interface SkillTemplateMeta {
  name: string;
  description: string;
}

function getTemplatesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'skill-templates');
  }
  return path.join(process.cwd(), 'resources', 'skill-templates');
}

function parseDescription(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return '';
  const descLine = fmMatch[1]
    .split('\n')
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
      result.push({ name, description: parseDescription(content) });
    } catch {
      // 不是有效模板目录，跳过
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

const EXTRA_FILES: Record<string, string[]> = {
  'article-parser': ['common.md', 'platforms/wechat.py'],
};

export async function subscribeSkillTemplate(
  workspacePath: string,
  name: string,
  overwrite: boolean,
): Promise<void> {
  const templatesDir = getTemplatesDir();
  const srcSkillPath = path.join(templatesDir, name, 'SKILL.md');

  const skillDir = path.join(workspacePath, '.claude', 'skills', name);
  const destSkillPath = path.join(skillDir, 'SKILL.md');

  if (!overwrite) {
    try {
      await fs.access(destSkillPath);
      throw new Error('SKILL_EXISTS');
    } catch (err) {
      if (err instanceof Error && err.message === 'SKILL_EXISTS') throw err;
    }
  }

  const content = await fs.readFile(srcSkillPath, 'utf-8');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(destSkillPath, content, 'utf-8');

  const extras = EXTRA_FILES[name];
  if (extras) {
    for (const rel of extras) {
      const srcExtra = path.join(templatesDir, name, rel);
      const destExtra = path.join(skillDir, rel);
      try {
        const extraContent = await fs.readFile(srcExtra, 'utf-8');
        await fs.mkdir(path.dirname(destExtra), { recursive: true });
        await fs.writeFile(destExtra, extraContent, 'utf-8');
      } catch {
        // 附属文件缺失不阻塞
      }
    }
  }
}

export async function restoreSkillTemplate(
  workspacePath: string,
  name: string,
): Promise<void> {
  await subscribeSkillTemplate(workspacePath, name, true);
}

export async function getTemplateContent(name: string): Promise<string> {
  const skillPath = path.join(getTemplatesDir(), name, 'SKILL.md');
  return fs.readFile(skillPath, 'utf-8');
}
