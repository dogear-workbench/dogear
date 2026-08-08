/**
 * 文章解析器 Skill 规则目录管理服务
 *
 * 负责在应用启动时自动初始化 .dogear/skills/article-parser/ 目录（SDK local plugin 格式），
 * 包含 SKILL.md（plugin 入口）、common.md（通用常识）、platforms/wechat.py（微信解析脚本）、history.jsonl。
 * 模板内容从 resources/skill-templates/article-parser/ 读取。
 * 所有初始化操作是幂等的：文件已存在则不覆盖。
 */

import path from 'path';
import fs from 'fs/promises';
import electron from 'electron';
import { safeFileWrite } from './safe-json.js';
import { getTemplateContent } from './skill-template-service.js';

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

/**
 * 返回文章解析器 Skill 规则目录的绝对路径
 */
export function getArticleParserSkillsDir(): string {
  return path.join(getConfigDir(), 'skills', 'article-parser');
}

/**
 * 确保 Skill 规则目录和初始文件存在。
 * 幂等：文件已存在则跳过，不会覆盖 AI 已修改的内容。
 * 在应用启动时调用一次，错误不应阻塞启动。
 */
export async function ensureSkillsInitialized(): Promise<void> {
  const skillsDir = getArticleParserSkillsDir();
  const platformsDir = path.join(skillsDir, 'platforms');

  await fs.mkdir(platformsDir, { recursive: true });

  const skillPath = path.join(skillsDir, 'SKILL.md');
  const commonPath = path.join(skillsDir, 'common.md');
  const wechatPyPath = path.join(platformsDir, 'wechat.py');
  const historyPath = path.join(skillsDir, 'history.jsonl');

  const templatesDir = getTemplatesDir();
  const templateBase = path.join(templatesDir, 'article-parser');

  if (!(await fileExists(skillPath))) {
    const content = await getTemplateContent('article-parser');
    await safeFileWrite(skillPath, content);
  }
  if (!(await fileExists(commonPath))) {
    await copyTemplateFile(path.join(templateBase, 'common.md'), commonPath);
  }
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
