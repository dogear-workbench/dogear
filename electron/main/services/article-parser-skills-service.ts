/**
 * 文章解析器运行时目录管理服务
 *
 * 负责 .dogear/article-parser/ 目录的运行时文件初始化
 * （platforms/wechat.py 脚本、history.jsonl 解析历史）。
 * SKILL.md 模板内容直接由 pi-session 从 resources/skill-templates/ 读取，不再复制。
 */

import path from 'path';
import fs from 'fs/promises';
import type { Dirent } from 'fs';
import electron from 'electron';

const { app } = electron;

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getTemplatesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'skill-templates');
  }
  return path.join(process.cwd(), 'resources', 'skill-templates');
}

/** 返回文章解析器 Skill 规则目录的绝对路径 */
export function getArticleParserSkillsDir(): string {
  return path.join(getConfigDir(), 'article-parser');
}

export interface PlatformScriptEntry {
  /** 平台名（文件名去 .py） */
  name: string;
  fileName: string;
  size: number;
  updatedAt: number;
}

export async function listPlatformScripts(): Promise<PlatformScriptEntry[]> {
  const dir = path.join(getArticleParserSkillsDir(), 'platforms');
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries: PlatformScriptEntry[] = [];
  for (const d of dirents) {
    if (!d.isFile() || !d.name.endsWith('.py')) continue;
    try {
      const st = await fs.stat(path.join(dir, d.name));
      entries.push({ name: d.name.slice(0, -'.py'.length), fileName: d.name, size: st.size, updatedAt: st.mtimeMs });
    } catch (err) {
      console.warn('[article-parser] 脚本信息读取失败，跳过:', d.name, err);
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readPlatformScript(name: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`非法平台名: ${name}`);
  return fs.readFile(path.join(getArticleParserSkillsDir(), 'platforms', `${name}.py`), 'utf-8');
}

/**
 * 确保运行时目录和初始文件存在（platforms/wechat.py 脚本、history.jsonl）。
 * 幂等：文件已存在则跳过。SKILL.md 不再复制——由 pi-session 直接读模板源。
 */
export async function ensureSkillsInitialized(): Promise<void> {
  const skillsDir = getArticleParserSkillsDir();
  const platformsDir = path.join(skillsDir, 'platforms');

  await fs.mkdir(platformsDir, { recursive: true });

  const wechatPyPath = path.join(platformsDir, 'wechat.py');
  const historyPath = path.join(skillsDir, 'history.jsonl');

  const templatesDir = getTemplatesDir();
  const templateBase = path.join(templatesDir, 'article-parser');

  if (!(await fileExists(wechatPyPath))) {
    await copyTemplateFile(path.join(templateBase, 'platforms', 'wechat.py'), wechatPyPath);
  }
  if (!(await fileExists(historyPath))) {
    await fs.writeFile(historyPath, '', 'utf-8');
  }
}

async function copyTemplateFile(src: string, dest: string): Promise<void> {
  const content = await fs.readFile(src, 'utf-8');
  await fs.writeFile(dest, content, 'utf-8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
