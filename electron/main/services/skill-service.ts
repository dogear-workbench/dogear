/**
 * Skill 管理服务
 *
 * 职责：
 * - 扫描 SDK 自动加载的 skill 目录（settingSources: ['user', 'project']）
 *   - 用户级：~/.claude/skills/<name>/SKILL.md
 *   - 工作区级：<workspacePath>/.claude/skills/<name>/SKILL.md
 * - 列出内置 plugin（article-parser 常驻、stock-analysis 跟随工具包开关）
 * - 启用/禁用：通过物理重命名 SKILL.md ↔ SKILL.md.disabled 实现
 *   （SDK 没有原生禁用 API；扫描时找不到 SKILL.md 即跳过加载）
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { getArticleParserSkillsDir } from './article-parser-skills-service.js';

export type SkillSource = 'workspace' | 'user' | 'plugin' | 'marketplace';

export interface SkillEntry {
  source: SkillSource;
  name: string;
  description?: string;
  /** SKILL.md 所在目录（绝对路径） */
  dir: string;
  /** SKILL.md 文件路径（启用时是 SKILL.md，禁用时是 SKILL.md.disabled） */
  filePath: string;
  enabled: boolean;
  /** plugin 类型才有：跟随哪个工具包，'always' 表示常驻 */
  pluginGate?: 'always' | string;
  /** plugin 类型才有：当前工具包是否启用 */
  pluginActive?: boolean;
  /** marketplace 类型才有：来源插件标识，格式 "<name>@<marketplace>" */
  marketplacePlugin?: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;

/**
 * 极简 frontmatter 解析（仅取 name / description 字符串）。
 * 不引入 yaml 依赖；遇到怪格式则字段为 undefined。
 */
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

async function readSkillMeta(dir: string): Promise<{ name?: string; description?: string; enabled: boolean; filePath: string } | null> {
  const enabledPath = path.join(dir, 'SKILL.md');
  const disabledPath = path.join(dir, 'SKILL.md.disabled');

  let target: string | null = null;
  let enabled = false;
  try {
    await fs.access(enabledPath);
    target = enabledPath;
    enabled = true;
  } catch {
    try {
      await fs.access(disabledPath);
      target = disabledPath;
      enabled = false;
    } catch {
      return null;
    }
  }

  try {
    const content = await fs.readFile(target, 'utf-8');
    const meta = parseFrontmatter(content);
    return {
      name: meta.name,
      description: meta.description,
      enabled,
      filePath: target,
    };
  } catch {
    return { enabled, filePath: target };
  }
}

async function scanSkillsDir(rootDir: string, source: SkillSource): Promise<SkillEntry[]> {
  const result: SkillEntry[] = [];
  let entries: string[] = [];
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
      enabled: meta.enabled,
    });
  }

  return result;
}

interface InstalledPluginEntry {
  scope: 'user' | 'local';
  installPath: string;
  projectPath?: string;
  version?: string;
}

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, InstalledPluginEntry[]>;
}

async function readEnabledPlugins(settingsPath: string): Promise<Record<string, boolean>> {
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    const data = JSON.parse(content);
    return (data.enabledPlugins as Record<string, boolean>) ?? {};
  } catch {
    return {};
  }
}

async function resolveEnabledMarketplacePlugins(
  workspacePath: string | null | undefined,
): Promise<{ pluginKey: string; installPath: string }[]> {
  const installedPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');

  let installedFile: InstalledPluginsFile;
  try {
    const content = await fs.readFile(installedPath, 'utf-8');
    installedFile = JSON.parse(content);
  } catch {
    return [];
  }
  const plugins = installedFile.plugins;
  if (!plugins || typeof plugins !== 'object') return [];

  const userEnabled = await readEnabledPlugins(path.join(os.homedir(), '.claude', 'settings.json'));
  const projectEnabled = workspacePath
    ? await readEnabledPlugins(path.join(workspacePath, '.claude', 'settings.local.json'))
    : {};
  const merged: Record<string, boolean> = { ...userEnabled, ...projectEnabled };

  const result: { pluginKey: string; installPath: string }[] = [];
  for (const [pluginKey, entries] of Object.entries(plugins)) {
    if (merged[pluginKey] !== true) continue;
    if (!Array.isArray(entries)) continue;

    const entry = entries.find((e) => {
      if (e.scope === 'user') return true;
      if (e.scope === 'local' && workspacePath && e.projectPath) {
        return path.normalize(e.projectPath) === path.normalize(workspacePath);
      }
      return false;
    });
    if (!entry) continue;

    result.push({ pluginKey, installPath: entry.installPath });
  }
  return result;
}

/**
 * 列出当前工作区下启用的市场插件根目录路径（用于传给 SDK query() 的 plugins 参数）
 */
export async function listEnabledMarketplacePluginPaths(
  workspacePath: string | null | undefined,
): Promise<string[]> {
  const list = await resolveEnabledMarketplacePlugins(workspacePath);
  return list.map((p) => p.installPath);
}

async function scanMarketplaceSkills(workspacePath: string | null | undefined): Promise<SkillEntry[]> {
  const enabled = await resolveEnabledMarketplacePlugins(workspacePath);
  const result: SkillEntry[] = [];

  for (const { pluginKey, installPath } of enabled) {
    const skillsDir = path.join(installPath, 'skills');
    let skillDirs: string[] = [];
    try {
      skillDirs = await fs.readdir(skillsDir);
    } catch {
      continue;
    }

    for (const skillName of skillDirs) {
      const skillDir = path.join(skillsDir, skillName);
      try {
        const stat = await fs.stat(skillDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const skillFilePath = path.join(skillDir, 'SKILL.md');
      let content = '';
      try {
        content = await fs.readFile(skillFilePath, 'utf-8');
      } catch {
        continue;
      }

      const meta = parseFrontmatter(content);
      result.push({
        source: 'marketplace',
        name: meta.name ?? skillName,
        description: meta.description,
        dir: skillDir,
        filePath: skillFilePath,
        enabled: true,
        marketplacePlugin: pluginKey,
      });
    }
  }

  return result;
}

/**
 * 列出所有 Skill：
 * - plugin 段：article-parser（常驻；stock-analysis 已迁移到订阅模板，不在此处出现）
 * - workspace 段：<workspacePath>/.claude/skills/*（含订阅后的 stock-analysis 副本）
 * - user 段：~/.claude/skills/*
 * - marketplace 段：来自 Claude Code 市场的已启用插件 skills
 */
export async function listSkills(workspacePath: string | null | undefined): Promise<SkillEntry[]> {
  const result: SkillEntry[] = [];

  // 1. 内置 plugin（仅 article-parser）
  const articleDir = getArticleParserSkillsDir();
  const articleMeta = await readSkillMeta(articleDir);
  if (articleMeta) {
    result.push({
      source: 'plugin',
      name: articleMeta.name ?? 'article-parser',
      description: articleMeta.description,
      dir: articleDir,
      filePath: articleMeta.filePath,
      enabled: articleMeta.enabled,
      pluginGate: 'always',
      pluginActive: true,
    });
  }

  // 2. 工作区级
  if (workspacePath) {
    const workspaceSkillsDir = path.join(workspacePath, '.claude', 'skills');
    result.push(...(await scanSkillsDir(workspaceSkillsDir, 'workspace')));
  }

  // 3. 用户级
  const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
  result.push(...(await scanSkillsDir(userSkillsDir, 'user')));

  // 4. 市场插件
  result.push(...(await scanMarketplaceSkills(workspacePath)));

  return result;
}

/**
 * 启用/禁用单个 Skill。
 * 通过重命名 SKILL.md ↔ SKILL.md.disabled 实现，下次会话扫描时生效。
 *
 * 安全约束：dir 必须是 user/workspace/plugin 三类合法目录之一。
 */
export async function setSkillEnabled(
  dir: string,
  enabled: boolean,
  workspacePath: string | null | undefined,
): Promise<void> {
  const allowedRoots = [
    path.join(os.homedir(), '.claude', 'skills'),
    getArticleParserSkillsDir(),
  ];
  if (workspacePath) {
    allowedRoots.push(path.join(workspacePath, '.claude', 'skills'));
  }
  const normalized = path.normalize(dir);
  const allowed = allowedRoots.some((root) => {
    const r = path.normalize(root);
    return normalized === r || normalized.startsWith(r + path.sep);
  });
  if (!allowed) {
    throw new Error(`Skill 目录不在允许范围内: ${dir}`);
  }

  const enabledPath = path.join(dir, 'SKILL.md');
  const disabledPath = path.join(dir, 'SKILL.md.disabled');

  if (enabled) {
    try {
      await fs.access(disabledPath);
    } catch {
      // 已经启用或不存在，幂等返回
      return;
    }
    await fs.rename(disabledPath, enabledPath);
  } else {
    try {
      await fs.access(enabledPath);
    } catch {
      return;
    }
    await fs.rename(enabledPath, disabledPath);
  }
}
