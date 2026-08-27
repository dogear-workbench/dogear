/**
 * 文章解析器运行时目录管理服务
 *
 * 负责 .dogear/article-parser/ 目录的运行时文件初始化
 * （platforms/wechat.py 脚本、history.jsonl 解析历史）。
 * SKILL.md 模板内容直接由 pi-session 从 resources/skill-templates/ 读取，不再复制。
 */

import path from 'path';
import fsSync from 'fs';
import fs from 'fs/promises';
import electron from 'electron';
import { mainLogger } from '../agents/logger.js';

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
 * 返回文章解析器 Skill 规则目录的绝对路径。
 * 存在性回退：新目录存在返回新路径，否则旧目录存在返回旧路径，都不存在返回新路径
 * （迁移失败时继续用旧目录，保证解析功能不断）。
 */
export function getArticleParserSkillsDir(): string {
  const newDir = path.join(getConfigDir(), 'article-parser');
  if (fsSync.existsSync(newDir)) return newDir;
  const oldDir = path.join(getConfigDir(), 'skills', 'article-parser');
  if (fsSync.existsSync(oldDir)) return oldDir;
  return newDir;
}

/**
 * 一次性迁移：旧目录 .dogear/skills/article-parser 存在且新目录不存在时整目录 rename；
 * 顺带删除 .dogear/skills/ 下的 review / stock-analysis 死遗留目录
 * （custom skill 目录全局化后 .dogear/skills/ 会被扫描，死遗留不能留）。
 * 失败仅 log 不抛。
 */
async function migrateLegacyDirs(): Promise<void> {
  try {
    const configDir = getConfigDir();
    const oldDir = path.join(configDir, 'skills', 'article-parser');
    const newDir = path.join(configDir, 'article-parser');

    if ((await fileExists(oldDir)) && !(await fileExists(newDir))) {
      await fs.mkdir(path.dirname(newDir), { recursive: true });
      await fs.rename(oldDir, newDir);
      mainLogger.info('article-parser 运行时目录已迁移:', { from: oldDir, to: newDir });
    }

    for (const legacy of ['review', 'stock-analysis']) {
      const legacyDir = path.join(configDir, 'skills', legacy);
      if (await fileExists(legacyDir)) {
        await fs.rm(legacyDir, { recursive: true });
        mainLogger.info('已清理死遗留目录:', { dir: legacyDir });
      }
    }
  } catch (err) {
    mainLogger.warn('article-parser 目录迁移失败（忽略，继续用旧目录）:', err);
  }
}

/**
 * 确保运行时目录和初始文件存在（platforms/wechat.py 脚本、history.jsonl）。
 * 幂等：文件已存在则跳过。SKILL.md 不再复制——由 pi-session 直接读模板源。
 */
export async function ensureSkillsInitialized(): Promise<void> {
  await migrateLegacyDirs();
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
