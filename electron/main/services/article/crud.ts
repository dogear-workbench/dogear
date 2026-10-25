/**
 * 文章存储 CRUD（一文一 md + frontmatter + 伴随 <slug>.raw.html，落 {workspacePath}/dogear/articles/）
 *
 * - id 是稳定标识：内嵌 frontmatter，文件名/文件夹可自由改名，查找按全库扫描 id 匹配（量级几百篇全扫无压力）
 * - workspaceId 用于事件/历史/日志，存储定位全走 workspacePath（task-service 双参先例）
 */
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { safeFileWrite } from '../safe-json.js';
import { takeSnapshot } from '../git-service/index.js';
import { ARTICLES_DIR, getArticlesRoot, isArticlesRelPath, type Article, type ArticleMeta, type ArticleParseStatus } from './types.js';
import { buildArticleSlug, parseArticleFile, resolveSlugConflict, serializeFrontmatter } from './frontmatter.js';

/** 库内文章文件命中（全库扫描的统一产物流） */
interface ArticleFileHit {
  absPath: string;
  /** 工作区相对路径（dogear/articles/...） */
  relPath: string;
  meta: ArticleMeta;
  content: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 从 md 绝对路径推伴随 raw.html 路径 */
function companionHtmlPath(mdAbsPath: string): string {
  return mdAbsPath.replace(/\.md$/i, '.raw.html');
}

/** 读 frontmatter id（冲突消解与查找共用）；无 id 返回 null */
async function readFrontmatterId(mdPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(mdPath, 'utf-8');
    return parseArticleFile(raw)?.meta.id ?? null;
  } catch {
    return null;
  }
}

/** 递归收集库内全部 .md 文件（跳过 . 开头隐藏段与 .history 留痕区） */
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
    if (entry.isDirectory()) {
      await collectMdFiles(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

/** 全库扫描文章文件（解析失败的文件跳过，按 fetchedAt 倒序） */
async function listArticleFiles(workspacePath: string): Promise<ArticleFileHit[]> {
  const root = getArticlesRoot(workspacePath);
  const mdFiles: string[] = [];
  await collectMdFiles(root, mdFiles);

  const hits: ArticleFileHit[] = [];
  for (const absPath of mdFiles) {
    try {
      const raw = await fs.readFile(absPath, 'utf-8');
      const parsed = parseArticleFile(raw);
      if (!parsed) continue;
      hits.push({
        absPath,
        relPath: `${ARTICLES_DIR}/${toPosix(path.relative(root, absPath))}`,
        meta: parsed.meta,
        content: parsed.content,
      });
    } catch {
      continue;
    }
  }
  hits.sort((a, b) => b.meta.fetchedAt - a.meta.fetchedAt);
  return hits;
}

async function findArticleFileById(workspacePath: string, articleId: string): Promise<ArticleFileHit | null> {
  const all = await listArticleFiles(workspacePath);
  return all.find((h) => h.meta.id === articleId) ?? null;
}

/** 库内目录写入落盘：slug 冲突消解后写 md + 伴随 raw.html，返回实际相对路径 */
async function writeArticleFile(params: {
  workspaceId: string | undefined;
  workspacePath: string;
  meta: ArticleMeta;
  content: string;
  rawHtml?: string;
  /** 文章库内目标文件夹路径（支持多层，各段不存在时自动创建） */
  folder?: string;
}): Promise<{ relPath: string; absPath: string }> {
  const root = getArticlesRoot(params.workspacePath);
  const dir = params.folder ? path.join(root, ...params.folder.split('/').filter(Boolean)) : root;
  await fs.mkdir(dir, { recursive: true });

  const slug = await resolveSlugConflict(dir, buildArticleSlug(params.meta.title), params.meta.id, readFrontmatterId);
  const absPath = path.join(dir, `${slug}.md`);
  await safeFileWrite(absPath, serializeFrontmatter(params.meta) + params.content);
  if (params.rawHtml !== undefined) {
    await safeFileWrite(companionHtmlPath(absPath), params.rawHtml);
  }
  const relPath = `${ARTICLES_DIR}/${toPosix(path.relative(root, absPath))}`;
  if (params.workspaceId) {
    void takeSnapshot(params.workspaceId, params.workspacePath, 'agent-write', relPath).catch(() => {});
  }
  return { relPath, absPath };
}

/**
 * 保存文章（Readability 路径；meta 已含 id/parseStatus）
 * @returns 实际写入的工作区相对路径
 */
export async function saveArticle(
  workspaceId: string,
  workspacePath: string,
  articleData: { meta: ArticleMeta; content: string; rawHtml?: string; folder?: string },
): Promise<string> {
  const { relPath } = await writeArticleFile({
    workspaceId,
    workspacePath,
    meta: articleData.meta,
    content: articleData.content,
    rawHtml: articleData.rawHtml,
    folder: articleData.folder,
  });
  return relPath;
}

/** 保存平台脚本直接输出的文章：构造 meta（script_ok）并落盘 */
export async function saveArticleFromScript(params: {
  workspaceId: string;
  workspacePath: string;
  url: string;
  rawHtml: string;
  title: string;
  content: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  language: string | null;
  folder?: string;
}): Promise<{ meta: ArticleMeta; relPath: string }> {
  const meta: ArticleMeta = {
    id: uuidv4(),
    url: params.url,
    title: params.title,
    author: params.author,
    siteName: params.siteName,
    excerpt: params.excerpt,
    wordCount: params.content.replace(/\s+/g, '').length,
    fetchedAt: Date.now(),
    language: params.language,
    parseStatus: 'script_ok',
  };
  const { relPath } = await writeArticleFile({
    workspaceId: params.workspaceId,
    workspacePath: params.workspacePath,
    meta,
    content: params.content,
    rawHtml: params.rawHtml,
    folder: params.folder,
  });
  return { meta, relPath };
}

/**
 * AI 介入时创建占位文章：写 stub md（parseStatus: ai_parsing）+ 伴随 raw.html，不写正文。
 * AI 任务完成后通过 dogear__SaveParsedArticle 覆盖 frontmatter 与正文。
 */
export async function saveRawHtmlStub(params: {
  workspaceId: string;
  workspacePath: string;
  articleId: string;
  url: string;
  rawHtml?: string;
}): Promise<string> {
  const meta: ArticleMeta = {
    id: params.articleId,
    url: params.url,
    title: '(AI 解析中...)',
    author: null,
    siteName: null,
    excerpt: null,
    wordCount: 0,
    fetchedAt: Date.now(),
    language: null,
    parseStatus: 'ai_parsing',
  };
  const { relPath } = await writeArticleFile({
    workspaceId: params.workspaceId,
    workspacePath: params.workspacePath,
    meta,
    content: '',
    rawHtml: params.rawHtml,
  });
  return relPath;
}

/** 列出文章库全部文章元数据（fetchedAt 倒序） */
export async function listArticles(workspaceId: string, workspacePath: string): Promise<ArticleMeta[]> {
  const hits = await listArticleFiles(workspacePath);
  return hits.map((h) => h.meta);
}

/** 按 id 查文章并带当前相对路径（历史 articleId 引用打开定位用）；未命中返回 null */
export async function getArticleWithRelPath(
  workspaceId: string,
  workspacePath: string,
  articleId: string,
): Promise<{ article: Article; relPath: string } | null> {
  const hit = await findArticleFileById(workspacePath, articleId);
  if (!hit) return null;
  return { article: { ...hit.meta, content: hit.content }, relPath: hit.relPath };
}

/** 按工作区相对路径读文章文件（未命中/非文章 md 返回 null） */
export async function getArticleFileByRelPath(
  workspacePath: string,
  relPath: string,
): Promise<Article | null> {
  if (!isArticlesRelPath(relPath) || !relPath.toLowerCase().endsWith('.md')) return null;
  const absPath = path.join(getArticlesRoot(workspacePath), ...relPath.slice(ARTICLES_DIR.length + 1).split('/'));
  try {
    const parsed = parseArticleFile(await fs.readFile(absPath, 'utf-8'));
    if (!parsed) return null;
    return { ...parsed.meta, content: parsed.content };
  } catch {
    return null;
  }
}

/**
 * 更新文章解析状态（只改 frontmatter 的 parseStatus，可选同步覆盖 title）
 * 供 AI 解析任务在开始/结束时回写使用；title 用于失败终态替换占位标题。
 * @returns 是否成功更新（文章不存在时返回 false，不抛异常）
 */
export async function updateArticleParseStatus(
  workspaceId: string,
  workspacePath: string,
  articleId: string,
  parseStatus: ArticleParseStatus,
  title?: string,
): Promise<boolean> {
  const hit = await findArticleFileById(workspacePath, articleId);
  if (!hit) return false;
  try {
    const meta: ArticleMeta = { ...hit.meta, parseStatus };
    if (title !== undefined) meta.title = title;
    await safeFileWrite(hit.absPath, serializeFrontmatter(meta) + hit.content);
    return true;
  } catch {
    return false;
  }
}

/** 删除文章文件（md + 伴随 raw.html），供管线 URL 去重清理 failed 旧条目 */
export async function deleteArticleEntry(workspaceId: string, workspacePath: string, articleId: string): Promise<void> {
  const hit = await findArticleFileById(workspacePath, articleId);
  if (!hit) return;
  await safeUnlink(hit.absPath);
  await safeUnlink(companionHtmlPath(hit.absPath));
  void takeSnapshot(workspaceId, workspacePath, 'ui-delete', hit.relPath).catch(() => {});
}

/** 树侧删除文章文件（含伴随 raw.html）；返回是否由本函数处理 */
export async function deleteArticleFileByRelPath(
  workspaceId: string | undefined,
  workspacePath: string,
  relPath: string,
): Promise<boolean> {
  if (!isArticlesRelPath(relPath) || !relPath.toLowerCase().endsWith('.md')) return false;
  const absPath = path.join(getArticlesRoot(workspacePath), ...relPath.slice(ARTICLES_DIR.length + 1).split('/'));
  await safeUnlink(absPath);
  await safeUnlink(companionHtmlPath(absPath));
  if (workspaceId) void takeSnapshot(workspaceId, workspacePath, 'ui-delete', relPath).catch(() => {});
  return true;
}

/** 树侧重命名文章文件：伴随 raw.html 同步改名；返回是否由本函数处理 */
export async function renameArticleFileWithCompanion(
  workspaceId: string | undefined,
  workspacePath: string,
  relPath: string,
  newName: string,
): Promise<boolean> {
  if (!isArticlesRelPath(relPath) || !relPath.toLowerCase().endsWith('.md')) return false;
  const root = getArticlesRoot(workspacePath);
  const oldAbs = path.join(root, ...relPath.slice(ARTICLES_DIR.length + 1).split('/'));
  const safeName = newName.replace(/[\\/:*?"<>|]/g, ' ').trim().replace(/[.\s]+$/, '') || 'untitled';
  const newAbs = path.join(path.dirname(oldAbs), safeName.toLowerCase().endsWith('.md') ? safeName : `${safeName}.md`);

  const oldHtml = companionHtmlPath(oldAbs);
  const hasHtml = await exists(oldHtml);
  await fs.rename(oldAbs, newAbs);
  if (hasHtml) await fs.rename(oldHtml, companionHtmlPath(newAbs)).catch(() => {});

  const parent = toPosix(path.dirname(relPath));
  const newRel = `${parent === ARTICLES_DIR ? ARTICLES_DIR : parent}/${path.basename(newAbs)}`;
  if (workspaceId) void takeSnapshot(workspaceId, workspacePath, 'ui-rename', newRel).catch(() => {});
  return true;
}

/** 树侧移动文章文件：伴随 raw.html 跟随；返回是否由本函数处理 */
export async function moveArticleFileWithCompanion(
  workspaceId: string | undefined,
  workspacePath: string,
  sourceRelPath: string,
  targetFolderRelPath: string,
): Promise<boolean> {
  if (!isArticlesRelPath(sourceRelPath) || !sourceRelPath.toLowerCase().endsWith('.md')) return false;
  if (!isArticlesRelPath(targetFolderRelPath)) return false;
  const root = getArticlesRoot(workspacePath);
  const sourceAbs = path.join(root, ...sourceRelPath.slice(ARTICLES_DIR.length + 1).split('/'));
  const targetDirAbs = path.join(root, ...targetFolderRelPath.slice(ARTICLES_DIR.length + 1).split('/'));
  const targetAbs = path.join(targetDirAbs, path.basename(sourceAbs));

  const oldHtml = companionHtmlPath(sourceAbs);
  const hasHtml = await exists(oldHtml);
  await fs.mkdir(targetDirAbs, { recursive: true });
  try {
    await fs.rename(sourceAbs, targetAbs);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      await fs.cp(sourceAbs, targetAbs);
      await fs.rm(sourceAbs, { force: true });
    } else {
      throw err;
    }
  }
  if (hasHtml) {
    const targetHtml = companionHtmlPath(targetAbs);
    try {
      await fs.rename(oldHtml, targetHtml);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        await fs.cp(oldHtml, targetHtml);
        await fs.rm(oldHtml, { force: true });
      }
    }
  }

  const newRel = `${toPosix(targetFolderRelPath)}/${path.basename(targetAbs)}`;
  if (workspaceId) void takeSnapshot(workspaceId, workspacePath, 'ui-rename', newRel).catch(() => {});
  return true;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    // 目标不存在/被占用不阻塞主流程
  }
}
