/**
 * 文章库一次性迁移：configDir/workspaces/{wsid}/articles/（UUID 目录：meta.json+content.md+raw.html）
 * → {工作区}/dogear/articles/[原文件夹/]<slug>.md + <slug>.raw.html
 *
 * 幂等策略（绝不丢数据）：
 * - 源 articles 不存在/为空 → 跳过
 * - 目标库已有同 id 文章 → 跳过该篇（重复启动安全）
 * - slug 冲突（同 slug 不同 id）→ -2 尾缀
 * - configDir 旧 articles 目录保留不删（留一个发布周期后人工清理）
 * - 迁移清单落 {ws}/dogear/articles/.migration-log.json 供核对
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readRegisteredWorkspaces } from './data-registry.js';
import { getWorkspaceDataDir } from './workspace-data-root.js';
import { getArticlesRoot } from './article/types.js';
import { buildArticleSlug, parseArticleFile, resolveSlugConflict, serializeFrontmatter } from './article/frontmatter.js';
import { safeJsonWrite } from './safe-json.js';

interface MigrationLogItem {
  id: string;
  from: string;
  to: string;
}

interface MigrationLog {
  migratedAt: string;
  workspaceId: string;
  items: MigrationLogItem[];
  skipped: MigrationLogItem[];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 递归收集含 meta.json 的文章目录（. 开头段与其他文件忽略） */
async function collectArticleDirs(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    if (await pathExists(path.join(full, 'meta.json'))) {
      out.push(full);
    } else {
      await collectArticleDirs(full, out);
    }
  }
}

export async function migrateArticlesIfNeeded(): Promise<void> {
  const registered = await readRegisteredWorkspaces();
  for (const ws of registered) {
    try {
      await migrateWorkspace(ws.id, ws.path);
    } catch (err) {
      console.error(`[article-migration] 工作区 ${ws.id} 文章迁移失败:`, err);
    }
  }
}

async function migrateWorkspace(workspaceId: string, workspacePath: string): Promise<void> {
  const sourceRoot = path.join(getWorkspaceDataDir(workspaceId), 'articles');
  if (!(await pathExists(sourceRoot))) return;

  const articleDirs: string[] = [];
  await collectArticleDirs(sourceRoot, articleDirs);
  if (articleDirs.length === 0) return;

  const targetRoot = getArticlesRoot(workspacePath);
  await fs.mkdir(targetRoot, { recursive: true });

  const items: MigrationLogItem[] = [];
  const skipped: MigrationLogItem[] = [];
  const existingIds = new Set(await collectTargetIds(targetRoot));

  for (const articleDir of articleDirs) {
    try {
      const metaRaw = await fs.readFile(path.join(articleDir, 'meta.json'), 'utf-8');
      const meta = JSON.parse(metaRaw);
      if (typeof meta?.id !== 'string' || typeof meta?.url !== 'string' || existingIds.has(meta.id)) {
        skipped.push({ id: String(meta?.id ?? '?'), from: articleDir, to: '' });
        continue;
      }

      let content = '';
      try {
        content = await fs.readFile(path.join(articleDir, 'content.md'), 'utf-8');
      } catch {
        // stub 条目无 content.md（AI 解析未完成），落空正文
      }
      let rawHtml: string | undefined;
      const rawHtmlPath = path.join(articleDir, 'raw.html');
      if (await pathExists(rawHtmlPath)) rawHtml = await fs.readFile(rawHtmlPath, 'utf-8');

      const relFolder = path.relative(sourceRoot, path.dirname(articleDir)).replace(/\\/g, '/');
      const dir = relFolder && relFolder !== '.' ? path.join(targetRoot, ...relFolder.split('/')) : targetRoot;
      await fs.mkdir(dir, { recursive: true });

      const slug = await resolveSlugConflict(dir, buildArticleSlug(String(meta.title ?? '')), meta.id, readTargetFrontmatterId);
      const mdPath = path.join(dir, `${slug}.md`);
      await fs.writeFile(mdPath, serializeFrontmatter(meta) + content, 'utf-8');
      if (rawHtml !== undefined) {
        await fs.writeFile(mdPath.replace(/\.md$/i, '.raw.html'), rawHtml, 'utf-8');
      }

      existingIds.add(meta.id);
      items.push({
        id: meta.id,
        from: path.relative(sourceRoot, articleDir).replace(/\\/g, '/'),
        to: path.relative(targetRoot, mdPath).replace(/\\/g, '/'),
      });
    } catch (err) {
      console.warn(`[article-migration] 跳过无法迁移的文章目录: ${articleDir}`, err);
    }
  }

  if (items.length > 0 || skipped.length > 0) {
    const log: MigrationLog = { migratedAt: new Date().toISOString(), workspaceId, items, skipped };
    await safeJsonWrite(path.join(targetRoot, '.migration-log.json'), log);
    console.log(`[article-migration] 工作区 ${workspaceId} 迁移 ${items.length} 篇（跳过 ${skipped.length} 篇）`);
  }
}

/** 扫目标库现存 frontmatter id（幂等判定） */
async function collectTargetIds(targetRoot: string): Promise<string[]> {
  const ids: string[] = [];
  const mdFiles: string[] = [];
  await collectMdFiles(targetRoot, mdFiles);
  for (const file of mdFiles) {
    try {
      const parsed = parseArticleFile(await fs.readFile(file, 'utf-8'));
      if (parsed) ids.push(parsed.meta.id);
    } catch {
      continue;
    }
  }
  return ids;
}

async function collectMdFiles(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectMdFiles(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
}

async function readTargetFrontmatterId(mdPath: string): Promise<string | null> {
  try {
    const parsed = parseArticleFile(await fs.readFile(mdPath, 'utf-8'));
    return parsed?.meta.id ?? null;
  } catch {
    return null;
  }
}
