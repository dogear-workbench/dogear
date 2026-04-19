/**
 * 网络文章解析服务
 * 负责抓取、解析、存储网络文章到工作区文件系统
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { safeJsonWrite, safeFileWrite } from './safe-json.js';
import type { WorkspaceFileNode } from '../types.js';

/** 文章解析状态（与 types/article.ts 的 ArticleParseStatus 保持一致） */
export type ArticleParseStatus =
  | 'script_ok'        // 新增：平台脚本解析成功（零 AI）
  | 'fixed'
  | 'ai_parsing'
  | 'ai_enhanced'
  | 'quality_warning'
  | 'failed';

/** 文章元数据（存储在 meta.json） */
export interface ArticleMeta {
  id: string;
  url: string;
  title: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  wordCount: number;
  fetchedAt: number;
  language: string | null;
  parseStatus?: ArticleParseStatus;
}

/** 文章完整数据（meta + 正文内容） */
export interface Article extends ArticleMeta {
  content: string;
}

// Turndown 实例（HTML → Markdown 转换器）
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

/** 文章存储根目录名 */
const ARTICLES_DIR = '.dogear/articles';

/** 文章排序索引文件名 */
const ORDER_FILE = '.order.json';

// ============================================================
// 排序索引读写（.dogear/articles/.order.json）
// ============================================================

/** 排序索引文件结构 */
interface ArticleOrderFile {
  version: number;
  children: Record<string, string[]>; // 目录相对路径 → 子项 basename 数组
}

function emptyOrder(): ArticleOrderFile {
  return { version: 1, children: {} };
}

async function loadArticleOrder(workspacePath: string): Promise<ArticleOrderFile> {
  try {
    const orderPath = path.join(workspacePath, ARTICLES_DIR, ORDER_FILE);
    const raw = await fs.readFile(orderPath, 'utf-8');
    return JSON.parse(raw) as ArticleOrderFile;
  } catch {
    return emptyOrder();
  }
}

async function saveArticleOrder(workspacePath: string, data: ArticleOrderFile): Promise<void> {
  const orderPath = path.join(workspacePath, ARTICLES_DIR, ORDER_FILE);
  await safeJsonWrite(orderPath, data);
}

/**
 * 将项目添加到排序索引
 * @param parentRelPath - 父目录的相对路径（如 ".dogear/articles"）
 * @param itemBasename - 新项目的 basename
 * @param isFolder - 是否为文件夹（文件夹插入到文件夹区末尾，文章插入到文章区开头）
 */
async function addToOrder(
  workspacePath: string,
  parentRelPath: string,
  itemBasename: string,
  isFolder: boolean,
): Promise<void> {
  const order = await loadArticleOrder(workspacePath);
  if (!order.children[parentRelPath]) {
    order.children[parentRelPath] = [];
  }
  const children = order.children[parentRelPath];
  // 避免重复
  if (children.includes(itemBasename)) return;

  if (isFolder) {
    // 文件夹插入到最后一个文件夹之后
    let insertIndex = 0;
    // 需要判断哪些是文件夹 — 简化处理：直接 push 到前面
    // 因为 scanArticleDirectory 会强制文件夹优先，这里追加到开头
    children.unshift(itemBasename);
  } else {
    // 文章插入到文件夹之后的第一个位置（即文章区开头）
    // 由于我们不知道哪些是文件夹，追加到末尾（unshift 可能打乱文件夹排序）
    // 排序会由 scanArticleDirectory 的文件夹优先逻辑保证
    children.push(itemBasename);
  }
  await saveArticleOrder(workspacePath, order);
}

/**
 * 从排序索引中移除项目
 */
async function removeFromOrder(
  workspacePath: string,
  parentRelPath: string,
  itemBasename: string,
): Promise<void> {
  const order = await loadArticleOrder(workspacePath);
  const children = order.children[parentRelPath];
  if (!children) return;
  const index = children.indexOf(itemBasename);
  if (index !== -1) {
    children.splice(index, 1);
  }
  await saveArticleOrder(workspacePath, order);
}

/**
 * 移动项目在排序索引中的位置
 * 同时更新源目录和目标目录的排序
 */
async function moveInOrder(
  workspacePath: string,
  sourceParentRelPath: string,
  targetParentRelPath: string,
  itemBasename: string,
  targetIndex?: number,
  isFolder?: boolean,
): Promise<void> {
  const order = await loadArticleOrder(workspacePath);

  // 从源目录移除
  if (order.children[sourceParentRelPath]) {
    const idx = order.children[sourceParentRelPath].indexOf(itemBasename);
    if (idx !== -1) {
      order.children[sourceParentRelPath].splice(idx, 1);
    }
  }

  // 插入目标目录
  if (!order.children[targetParentRelPath]) {
    order.children[targetParentRelPath] = [];
  }
  const targetChildren = order.children[targetParentRelPath];
  if (targetIndex !== undefined && targetIndex >= 0) {
    targetChildren.splice(targetIndex, 0, itemBasename);
  } else {
    targetChildren.push(itemBasename);
  }

  // 强制维护文件夹优先分区
  if (isFolder !== undefined) {
    // 如果有明确的类型信息就用它来分区
    // 但通常我们不知道，由 scanArticleDirectory 保证
  }

  await saveArticleOrder(workspacePath, order);
}

/**
 * 重命名排序索引中的项目
 */
async function renameInOrder(
  workspacePath: string,
  parentRelPath: string,
  oldBasename: string,
  newBasename: string,
): Promise<void> {
  const order = await loadArticleOrder(workspacePath);

  // 更新父目录中的引用
  const children = order.children[parentRelPath];
  if (children) {
    const idx = children.indexOf(oldBasename);
    if (idx !== -1) {
      children[idx] = newBasename;
    }
  }

  // 如果是文件夹，还需要更新其自身的 children key
  const oldKey = parentRelPath + '/' + oldBasename;
  const newKey = parentRelPath + '/' + newBasename;
  if (order.children[oldKey]) {
    order.children[newKey] = order.children[oldKey];
    delete order.children[oldKey];
  }

  await saveArticleOrder(workspacePath, order);
}

/**
 * 根据 URL 检测平台名称，用于选择对应的 Python 平台脚本。
 * 返回 null 表示未识别的平台，走 Readability 兜底。
 */
export function detectPlatform(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (host === 'mp.weixin.qq.com') return 'wechat';
    if (host.endsWith('.zhihu.com')) return 'zhihu';
    if (host.endsWith('.juejin.cn') || host === 'juejin.cn') return 'juejin';
    if (host.endsWith('.bilibili.com') || host === 'bilibili.com') return 'bilibili';
    return null;
  } catch {
    return null;
  }
}

/**
 * 仅抓取 URL 的原始 HTML，不做解析。
 * 供主流程在尝试平台脚本前预取，避免后续 Readability 重复抓取。
 */
export async function fetchRawHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok) {
    throw new Error(`抓取失败: HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/** tryPlatformScript 的返回值类型 */
export interface ScriptParseAttempt {
  ok: boolean;
  title?: string;
  content?: string;
  author?: string | null;
  siteName?: string | null;
  excerpt?: string | null;
  language?: string | null;
  durationMs: number;
  errorType?: string;
  errorMessage?: string;
}

/**
 * 尝试用平台脚本解析文章。
 * 脚本不存在 → ok=false, errorType='NoScript'（不是异常，是正常的"无脚本"情况）
 * 脚本成功 → ok=true 含解析结果
 * 脚本失败 → ok=false 含错误详情
 * 此函数永远不 throw，所有错误包装在返回值里。
 */
export async function tryPlatformScript(params: {
  platform: string;
  url: string;
  html: string;
  timeoutMs?: number;
}): Promise<ScriptParseAttempt> {
  const { getArticleParserSkillsDir } = await import('./article-parser-skills-service.js');
  const { pythonBridge } = await import('./stock/python-bridge.js');
  const scriptPath = path.join(getArticleParserSkillsDir(), 'platforms', `${params.platform}.py`);

  // 脚本不存在 → 静默返回（不报错）
  const exists = await fs.access(scriptPath).then(() => true).catch(() => false);
  if (!exists) {
    return {
      ok: false,
      durationMs: 0,
      errorType: 'NoScript',
      errorMessage: `No platform script for ${params.platform}`,
    };
  }

  try {
    const res = await pythonBridge.call<Record<string, unknown>>('run_article_script', {
      script_path: scriptPath,
      url: params.url,
      html: params.html,
      timeout_ms: params.timeoutMs ?? 5000,
    }, 30_000);

    return {
      ok: !!res.ok,
      title: typeof res.title === 'string' ? res.title : undefined,
      content: typeof res.content === 'string' ? res.content : undefined,
      author: typeof res.author === 'string' ? res.author : null,
      siteName: typeof res.site_name === 'string' ? res.site_name : null,
      excerpt: typeof res.excerpt === 'string' ? res.excerpt : null,
      language: typeof res.language === 'string' ? res.language : null,
      durationMs: typeof res.duration_ms === 'number' ? res.duration_ms : 0,
      errorType: typeof res.error_type === 'string' ? res.error_type : undefined,
      errorMessage: typeof res.error_message === 'string' ? res.error_message : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: 0,
      errorType: 'BridgeError',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 抓取并解析网络文章
 * @param url - 文章 URL
 * @param options.rawHtml - 可选：预先抓取的原始 HTML；提供时跳过网络请求
 * @returns 解析后的文章数据（meta + markdown 正文 + 原始 HTML）
 */
export async function fetchAndParseArticle(
  url: string,
  options?: { rawHtml?: string }
): Promise<{
  meta: ArticleMeta;
  content: string;
  rawHtml: string;
}> {
  // 1. 抓取 HTML（如果调用方已预取则直接使用，避免重复请求）
  let html: string;
  if (options?.rawHtml !== undefined) {
    html = options.rawHtml;
  } else {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`抓取失败: HTTP ${response.status} ${response.statusText}`);
    }
    html = await response.text();
  }

  // 2. 使用 linkedom 解析为 DOM
  const { document } = parseHTML(html);

  // 3. 预处理：移除隐藏样式（微信公众号等平台通过 JS 控制内容可见性，
  //    静态解析时内容 div 带有 visibility:hidden/display:none，需要移除）
  const hiddenElements = document.querySelectorAll('[style*="visibility: hidden"], [style*="visibility:hidden"], [style*="display: none"], [style*="display:none"]');
  for (const el of hiddenElements) {
    const style = (el.getAttribute('style') || '')
      .replace(/visibility\s*:\s*hidden\s*;?/gi, '')
      .replace(/opacity\s*:\s*0\s*;?/gi, '')
      .replace(/display\s*:\s*none\s*;?/gi, '')
      .trim();
    if (style) {
      el.setAttribute('style', style);
    } else {
      el.removeAttribute('style');
    }
  }

  // 4. 预处理：懒加载图片（微信等平台用 data-src 代替 src 实现懒加载，
  //    需要将 data-src 复制到 src，否则 Readability/Turndown 无法识别图片）
  const lazyImages = document.querySelectorAll('img[data-src]');
  for (const img of lazyImages) {
    const dataSrc = img.getAttribute('data-src');
    if (dataSrc) {
      img.setAttribute('src', dataSrc);
    }
  }

  // 5. 使用 Readability 提取正文
  const reader = new Readability(document);
  const article = reader.parse();

  // 5.1 检测微信短内容（随笔）类型
  //     微信短内容的 appmsg_type='9'，正文不在 DOM 中，而是嵌在 JS 变量
  //     text_page_info.content 里，Readability 无法提取
  const isWechat = url.includes('mp.weixin.qq.com');
  let wechatShortContent: string | null = null;
  let wechatTitle: string | null = null;
  let wechatAuthor: string | null = null;

  if (isWechat) {
    // 从 JS 中提取短内容正文（text_page_info.content）
    const contentMatch = html.match(/text_page_info:\s*\{[\s\S]*?content:\s*JsDecode\('([\s\S]*?)'\)/);
    if (contentMatch) {
      // 解码 \x0a 等转义字符，将换行符转为段落分隔
      wechatShortContent = contentMatch[1]
        .replace(/\\x0a/g, '\n')
        .replace(/\\x26/g, '&')
        .replace(/\\x27/g, "'")
        .replace(/\\x22/g, '"')
        .replace(/\\x3c/g, '<')
        .replace(/\\x3e/g, '>');
    }
    // 从 JS 中提取标题
    const titleMatch = html.match(/window\.msg_title\s*=\s*window\.title\s*=\s*'([^']*)'/);
    if (titleMatch) {
      wechatTitle = titleMatch[1];
    }
    // 从 JS 中提取作者
    const authorMatch = html.match(/nick_name:\s*JsDecode\('([^']*)'\)/);
    if (authorMatch) {
      wechatAuthor = authorMatch[1];
    }
  }

  // 判断 Readability 解析是否有效
  // 用 trim 后的文本长度判断，避免大量空白换行误判为有效内容
  // 同时如果微信短内容已提取成功且更长，优先使用短内容
  const trimmedTextLength = article?.textContent?.replace(/\s+/g, '').length || 0;
  const readabilityValid = article
    && trimmedTextLength > 100
    && (!wechatShortContent || trimmedTextLength > wechatShortContent.length);

  if (!readabilityValid && !wechatShortContent) {
    throw new Error('无法解析文章内容，页面可能不是标准文章格式');
  }

  let markdown: string;
  let finalTitle: string;
  let finalAuthor: string | null;
  let finalExcerpt: string | null;
  let finalWordCount: number;

  if (readabilityValid && article) {
    // 正常文章：使用 Readability 结果
    // 5.5 将正文中的相对路径图片转换为绝对 URL
    const baseUrl = new URL(url);
    const articleContent = (article.content || '').replace(
      /(<img\s[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
      (_match, prefix, quote, src) => {
        try {
          const absoluteUrl = new URL(src, baseUrl.origin).href;
          return `${prefix}${quote}${absoluteUrl}${quote}`;
        } catch {
          return _match;
        }
      }
    );
    markdown = turndown.turndown(articleContent);
    finalTitle = article.title || wechatTitle || '未知标题';
    finalAuthor = article.byline || wechatAuthor || null;
    finalExcerpt = article.excerpt || null;
    finalWordCount = article.textContent?.length || 0;
  } else {
    // 微信短内容 fallback：直接使用 JS 中提取的纯文本
    markdown = wechatShortContent!;
    finalTitle = wechatTitle || article?.title || '未知标题';
    finalAuthor = wechatAuthor || article?.byline || null;
    finalExcerpt = wechatShortContent!.slice(0, 200);
    finalWordCount = wechatShortContent!.length;
  }

  // 7. 组装结果
  const id = uuidv4();
  const meta: ArticleMeta = {
    id,
    url,
    title: finalTitle,
    author: finalAuthor,
    siteName: article?.siteName || (isWechat ? '微信公众平台' : null),
    excerpt: finalExcerpt,
    wordCount: finalWordCount,
    fetchedAt: Date.now(),
    language: article?.lang || null,
    parseStatus: 'fixed',  // 初始：固定解析完成，尚未经过 AI 检查
  };

  return { meta, content: markdown, rawHtml: html };
}

/**
 * 保存文章到工作区文件系统
 * @param workspacePath - 工作区绝对路径
 * @param articleData - 解析后的文章数据
 */
export async function saveArticle(
  workspacePath: string,
  articleData: { meta: ArticleMeta; content: string; rawHtml: string }
): Promise<void> {
  const articleDir = path.join(workspacePath, ARTICLES_DIR, articleData.meta.id);

  // 写入 meta.json（safeJsonWrite 内部会自动创建目录）
  await safeJsonWrite(path.join(articleDir, 'meta.json'), articleData.meta);

  // 写入 content.md（Markdown 正文）
  await safeFileWrite(path.join(articleDir, 'content.md'), articleData.content);

  // 写入 raw.html（原始 HTML，便于后续重新解析）
  await safeFileWrite(path.join(articleDir, 'raw.html'), articleData.rawHtml);

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
 * AI 任务完成后会通过 SaveParsedArticle 工具覆盖 meta 和 content。
 * 返回 articleDir 的绝对路径。
 */
export async function saveRawHtmlStub(params: {
  workspacePath: string;
  articleId: string;
  url: string;
  rawHtml: string;
}): Promise<string> {
  const articleDir = path.join(params.workspacePath, ARTICLES_DIR, params.articleId);

  const stubMeta: ArticleMeta = {
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

  await safeJsonWrite(path.join(articleDir, 'meta.json'), stubMeta);
  await safeFileWrite(path.join(articleDir, 'raw.html'), params.rawHtml);
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

/**
 * 递归扫描 .dogear/articles/ 目录，构建文章树
 * - 含 meta.json 的目录识别为文章节点（显示标题而非 UUID）
 * - 其他目录识别为分类文件夹
 */
export async function listArticleTree(workspacePath: string): Promise<WorkspaceFileNode[]> {
  const articlesDir = path.join(workspacePath, ARTICLES_DIR);
  const order = await loadArticleOrder(workspacePath);
  return scanArticleDirectory(articlesDir, workspacePath, order);
}

async function scanArticleDirectory(
  dirPath: string,
  workspacePath: string,
  order: ArticleOrderFile,
): Promise<WorkspaceFileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: WorkspaceFileNode[] = [];

    for (const entry of entries) {
      // 跳过隐藏文件（如 .order.json）和非目录
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');

      // 检查是否为文章目录（含 meta.json）
      const metaPath = path.join(fullPath, 'meta.json');
      try {
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const meta: ArticleMeta = JSON.parse(metaContent);
        nodes.push({
          name: meta.title,
          path: relativePath,
          type: 'article' as const,
          articleMeta: {
            id: meta.id,
            url: meta.url,
            siteName: meta.siteName,
            fetchedAt: meta.fetchedAt,
            wordCount: meta.wordCount,
          },
        });
      } catch {
        // 没有 meta.json → 是分类文件夹，递归扫描
        const children = await scanArticleDirectory(fullPath, workspacePath, order);
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory' as const,
          children,
        });
      }
    }

    // 按排序索引排序，不在索引中的追加到末尾
    const dirRelPath = path.relative(workspacePath, dirPath).replace(/\\/g, '/');
    const savedOrder = order.children[dirRelPath];

    if (savedOrder && savedOrder.length > 0) {
      // 按索引排序：先按 savedOrder 中的顺序，未记录的追加到末尾
      const nodeByBasename = new Map<string, WorkspaceFileNode>();
      for (const node of nodes) {
        nodeByBasename.set(path.basename(node.path), node);
      }

      const sorted: WorkspaceFileNode[] = [];
      const placed = new Set<string>();

      // 先按索引顺序添加
      for (const basename of savedOrder) {
        const node = nodeByBasename.get(basename);
        if (node) {
          sorted.push(node);
          placed.add(basename);
        }
      }

      // 未记录的项追加到末尾（文件夹优先 + 文章按时间倒序）
      const unplaced = nodes.filter(n => !placed.has(path.basename(n.path)));
      unplaced.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        if (a.type === 'article' && b.type === 'article') {
          return (b.articleMeta?.fetchedAt || 0) - (a.articleMeta?.fetchedAt || 0);
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      });
      sorted.push(...unplaced);

      // 最终强制文件夹优先分区
      const folders = sorted.filter(n => n.type === 'directory');
      const articles = sorted.filter(n => n.type !== 'directory');
      return [...folders, ...articles];
    }

    // 无排序索引时，使用默认排序：文件夹在前，文章按 fetchedAt 倒序
    nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      if (a.type === 'article' && b.type === 'article') {
        return (b.articleMeta?.fetchedAt || 0) - (a.articleMeta?.fetchedAt || 0);
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    return nodes;
  } catch {
    return [];
  }
}

/**
 * 在 .dogear/articles/ 下创建分类文件夹
 */
export async function createArticleFolder(
  workspacePath: string,
  parentRelPath: string,
  name: string
): Promise<void> {
  const parentAbsPath = path.join(workspacePath, parentRelPath);
  const newFolderPath = path.join(parentAbsPath, name);
  await fs.mkdir(newFolderPath, { recursive: true });

  // 更新排序索引
  await addToOrder(workspacePath, parentRelPath, name, true);
}

/**
 * 移动文章或文件夹到目标分类文件夹
 */
export async function moveArticleItem(
  workspacePath: string,
  sourceRelPath: string,
  targetFolderRelPath: string,
  targetIndex?: number,
): Promise<void> {
  const sourceAbsPath = path.join(workspacePath, sourceRelPath);
  const targetFolderAbsPath = path.join(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);

  // 获取源目录的相对路径
  const sourceParentRelPath = path.dirname(sourceRelPath).replace(/\\/g, '/');

  // 移动文件系统
  try {
    await fs.rename(sourceAbsPath, targetAbsPath);
  } catch (err: unknown) {
    // Windows 上 rename 可能因文件锁报 EPERM，用 copy + delete 作为 fallback
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      await fs.cp(sourceAbsPath, targetAbsPath, { recursive: true });
      await fs.rm(sourceAbsPath, { recursive: true, force: true });
    } else {
      throw err;
    }
  }

  // 更新排序索引
  await moveInOrder(workspacePath, sourceParentRelPath, targetFolderRelPath, itemName, targetIndex);
}

/**
 * 重命名文章分类文件夹
 */
export async function renameArticleFolder(
  workspacePath: string,
  folderRelPath: string,
  newName: string
): Promise<void> {
  const oldAbsPath = path.join(workspacePath, folderRelPath);
  const newAbsPath = path.join(path.dirname(oldAbsPath), newName);
  try {
    await fs.rename(oldAbsPath, newAbsPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      await fs.cp(oldAbsPath, newAbsPath, { recursive: true });
      await fs.rm(oldAbsPath, { recursive: true, force: true });
    } else {
      throw err;
    }
  }

  // 更新排序索引
  const parentRelPath = path.dirname(folderRelPath).replace(/\\/g, '/');
  const oldBasename = path.basename(folderRelPath);
  await renameInOrder(workspacePath, parentRelPath, oldBasename, newName);
}

/**
 * 删除文章分类文件夹（含内容）
 */
export async function deleteArticleFolder(
  workspacePath: string,
  folderRelPath: string
): Promise<void> {
  const absPath = path.join(workspacePath, folderRelPath);
  await fs.rm(absPath, { recursive: true, force: true });

  // 更新排序索引：从父目录中移除
  const parentRelPath = path.dirname(folderRelPath).replace(/\\/g, '/');
  const basename = path.basename(folderRelPath);
  await removeFromOrder(workspacePath, parentRelPath, basename);

  // 同时清理该目录自身的索引条目
  const order = await loadArticleOrder(workspacePath);
  delete order.children[folderRelPath];
  await saveArticleOrder(workspacePath, order);
}
