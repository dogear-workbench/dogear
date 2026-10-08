/**
 * 文章存储 CRUD（meta.json / content.md / raw.html 落盘）
 */
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { safeJsonWrite, safeFileWrite } from '../safe-json.js';
import { addToOrder, removeFromOrder } from './order-index.js';
import { ARTICLES_DIR } from './types.js';
import type { Article, ArticleMeta, ArticleParseStatus } from './types.js';

/**
 * 保存文章到工作区文件系统
 * @param workspacePath - 工作区绝对路径
 * @param articleData - 解析后的文章数据
 */
export async function saveArticle(
  workspacePath: string,
  articleData: { meta: ArticleMeta; content: string; rawHtml?: string }
): Promise<void> {
  const articleDir = path.join(workspacePath, ARTICLES_DIR, articleData.meta.id);

  // 写入 meta.json（safeJsonWrite 内部会自动创建目录）
  await safeJsonWrite(path.join(articleDir, 'meta.json'), articleData.meta);

  // 写入 content.md（Markdown 正文）
  await safeFileWrite(path.join(articleDir, 'content.md'), articleData.content);

  // 写入 raw.html（原始 HTML，便于后续重新解析）；fetch 分流路径无预取 HTML 时省略
  if (articleData.rawHtml !== undefined) {
    await safeFileWrite(path.join(articleDir, 'raw.html'), articleData.rawHtml);
  }

  // 更新排序索引
  await addToOrder(workspacePath, ARTICLES_DIR, articleData.meta.id, false);
}

/**
 * 保存平台脚本直接输出的文章。
 * 创建文章目录，写 meta.json / content.md / raw.html，更新排序索引。
 */
export async function saveArticleFromScript(params: {
  workspacePath: string;
  url: string;
  rawHtml: string;
  title: string;
  content: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  language: string | null;
}): Promise<ArticleMeta> {
  const id = uuidv4();
  const wordCount = params.content.replace(/\s+/g, '').length;

  const meta: ArticleMeta = {
    id,
    url: params.url,
    title: params.title,
    author: params.author,
    siteName: params.siteName,
    excerpt: params.excerpt,
    wordCount,
    fetchedAt: Date.now(),
    language: params.language,
    parseStatus: 'script_ok',
  };

  const articleDir = path.join(params.workspacePath, ARTICLES_DIR, id);
  await safeJsonWrite(path.join(articleDir, 'meta.json'), meta);
  await safeFileWrite(path.join(articleDir, 'content.md'), params.content);
  await safeFileWrite(path.join(articleDir, 'raw.html'), params.rawHtml);
  await addToOrder(params.workspacePath, ARTICLES_DIR, id, false);

  return meta;
}

/**
 * AI 介入时创建文章目录骨架：写 raw.html + stub meta.json，不写 content.md。
 * AI 任务完成后会通过 dogear__SaveParsedArticle 工具覆盖 meta 和 content。
 * need_login 分支传入自定义 title/parseStatus 复用同一落盘结构。
 * 返回 articleDir 的绝对路径。
 */
export async function saveRawHtmlStub(params: {
  workspacePath: string;
  articleId: string;
  url: string;
  rawHtml?: string;
  title?: string;
  parseStatus?: ArticleParseStatus;
}): Promise<string> {
  const articleDir = path.join(params.workspacePath, ARTICLES_DIR, params.articleId);

  const stubMeta: ArticleMeta = {
    id: params.articleId,
    url: params.url,
    title: params.title ?? '(AI 解析中...)',
    author: null,
    siteName: null,
    excerpt: null,
    wordCount: 0,
    fetchedAt: Date.now(),
    language: null,
    parseStatus: params.parseStatus ?? 'ai_parsing',
  };

  await safeJsonWrite(path.join(articleDir, 'meta.json'), stubMeta);
  if (params.rawHtml !== undefined) {
    await safeFileWrite(path.join(articleDir, 'raw.html'), params.rawHtml);
  }
  await addToOrder(params.workspacePath, ARTICLES_DIR, params.articleId, false);

  return articleDir;
}

/**
 * 列出工作区下所有已保存的文章
 * @param workspacePath - 工作区绝对路径
 * @returns 文章元数据数组，按抓取时间倒序排列
 */
export async function listArticles(workspacePath: string): Promise<ArticleMeta[]> {
  const articlesDir = path.join(workspacePath, ARTICLES_DIR);

  try {
    const entries = await fs.readdir(articlesDir, { withFileTypes: true });
    const articles: ArticleMeta[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        const metaPath = path.join(articlesDir, entry.name, 'meta.json');
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        articles.push(JSON.parse(metaContent));
      } catch {
        // 跳过无法读取的目录
        continue;
      }
    }

    // 按抓取时间倒序排列
    articles.sort((a, b) => b.fetchedAt - a.fetchedAt);
    return articles;
  } catch {
    // 目录不存在时返回空数组
    return [];
  }
}

/**
 * 在 articles 目录下递归搜索指定 ID 的文章目录
 * 文章可能被移动到子文件夹中，不能假设固定路径
 */
async function findArticleDirById(dirPath: string, articleId: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);

      if (entry.name === articleId) {
        // 确认是文章目录（含 meta.json）
        try {
          await fs.access(path.join(fullPath, 'meta.json'));
          return fullPath;
        } catch {
          // 目录名匹配但没有 meta.json，继续搜索子目录
        }
      }

      // 递归搜索子目录
      const found = await findArticleDirById(fullPath, articleId);
      if (found) return found;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 获取单篇文章的完整数据
 * @param workspacePath - 工作区绝对路径
 * @param articleId - 文章 ID (UUID)
 * @returns 文章完整数据（meta + 正文）
 */
export async function getArticle(
  workspacePath: string,
  articleId: string
): Promise<Article> {
  const articlesRoot = path.join(workspacePath, ARTICLES_DIR);

  // 先尝试直接路径（最常见情况），再递归搜索
  let articleDir = path.join(articlesRoot, articleId);
  try {
    await fs.access(path.join(articleDir, 'meta.json'));
  } catch {
    // 直接路径不存在，递归搜索（文章可能已被移到子文件夹）
    const found = await findArticleDirById(articlesRoot, articleId);
    if (!found) throw new Error(`文章不存在: ${articleId}`);
    articleDir = found;
  }

  // 读取 meta.json
  const metaContent = await fs.readFile(path.join(articleDir, 'meta.json'), 'utf-8');
  const meta: ArticleMeta = JSON.parse(metaContent);

  // 读取 content.md
  const content = await fs.readFile(path.join(articleDir, 'content.md'), 'utf-8');

  return { ...meta, content };
}

/**
 * 更新文章的解析状态（只修改 parseStatus 字段，其他字段保持不变）
 * 供 AI 质量检查任务在开始/结束时回写使用。
 * @returns 是否成功更新（文章不存在时返回 false，不抛异常）
 */
export async function updateArticleParseStatus(
  workspacePath: string,
  articleId: string,
  parseStatus: ArticleParseStatus,
): Promise<boolean> {
  const articlesRoot = path.join(workspacePath, ARTICLES_DIR);

  let articleDir = path.join(articlesRoot, articleId);
  try {
    await fs.access(path.join(articleDir, 'meta.json'));
  } catch {
    const found = await findArticleDirById(articlesRoot, articleId);
    if (!found) return false;
    articleDir = found;
  }

  try {
    const metaPath = path.join(articleDir, 'meta.json');
    const raw = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(raw) as ArticleMeta;
    meta.parseStatus = parseStatus;
    await safeJsonWrite(metaPath, meta);
    return true;
  } catch {
    return false;
  }
}

/**
 * 删除文章
 * @param workspacePath - 工作区绝对路径
 * @param articleId - 文章 ID (UUID)
 */
export async function deleteArticle(
  workspacePath: string,
  articleId: string
): Promise<void> {
  const articlesRoot = path.join(workspacePath, ARTICLES_DIR);

  // 先尝试直接路径，再递归搜索
  let articleDir = path.join(articlesRoot, articleId);
  try {
    await fs.access(path.join(articleDir, 'meta.json'));
  } catch {
    const found = await findArticleDirById(articlesRoot, articleId);
    if (!found) throw new Error(`文章不存在: ${articleId}`);
    articleDir = found;
  }

  // 获取文章在哪个父目录下
  const parentDir = path.dirname(articleDir);
  const parentRelPath = path.relative(path.join(workspacePath), parentDir).replace(/\\/g, '/');
  const basename = path.basename(articleDir);

  await fs.rm(articleDir, { recursive: true, force: true });

  // 更新排序索引
  await removeFromOrder(workspacePath, parentRelPath, basename);
}
