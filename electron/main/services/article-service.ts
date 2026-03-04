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
import type { WorkspaceFileNode } from '../types.js';
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

/**
 * 抓取并解析网络文章
 * @param url - 文章 URL
 * @returns 解析后的文章数据（meta + markdown 正文 + 原始 HTML）
 */
export async function fetchAndParseArticle(url: string): Promise<{
  meta: ArticleMeta;
  content: string;
  rawHtml: string;
}> {
  // 1. 抓取 HTML
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok) {
    throw new Error(`抓取失败: HTTP ${response.status} ${response.statusText}`);
  }
  const html = await response.text();

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

  // 创建文章目录
  await fs.mkdir(articleDir, { recursive: true });

  // 写入 meta.json
  await fs.writeFile(
    path.join(articleDir, 'meta.json'),
    JSON.stringify(articleData.meta, null, 2),
    'utf-8'
  );

  // 写入 content.md（Markdown 正文）
  await fs.writeFile(
    path.join(articleDir, 'content.md'),
    articleData.content,
    'utf-8'
  );

  // 写入 raw.html（原始 HTML，便于后续重新解析）
  await fs.writeFile(
    path.join(articleDir, 'raw.html'),
    articleData.rawHtml,
    'utf-8'
  );
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
 * 获取单篇文章的完整数据
 * @param workspacePath - 工作区绝对路径
 * @param articleId - 文章 ID (UUID)
 * @returns 文章完整数据（meta + 正文）
 */
export async function getArticle(
  workspacePath: string,
  articleId: string
): Promise<Article> {
  const articleDir = path.join(workspacePath, ARTICLES_DIR, articleId);

  // 读取 meta.json
  const metaContent = await fs.readFile(path.join(articleDir, 'meta.json'), 'utf-8');
  const meta: ArticleMeta = JSON.parse(metaContent);

  // 读取 content.md
  const content = await fs.readFile(path.join(articleDir, 'content.md'), 'utf-8');

  return { ...meta, content };
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
  const articleDir = path.join(workspacePath, ARTICLES_DIR, articleId);
  await fs.rm(articleDir, { recursive: true, force: true });
}

/**
 * 递归扫描 .dogear/articles/ 目录，构建文章树
 * - 含 meta.json 的目录识别为文章节点（显示标题而非 UUID）
 * - 其他目录识别为分类文件夹
 */
export async function listArticleTree(workspacePath: string): Promise<WorkspaceFileNode[]> {
  const articlesDir = path.join(workspacePath, ARTICLES_DIR);
  return scanArticleDirectory(articlesDir, workspacePath);
}

async function scanArticleDirectory(dirPath: string, workspacePath: string): Promise<WorkspaceFileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: WorkspaceFileNode[] = [];

    for (const entry of entries) {
      // 跳过隐藏文件（如 .folders.json）和非目录
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
        const children = await scanArticleDirectory(fullPath, workspacePath);
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'directory' as const,
          children,
        });
      }
    }

    // 文件夹在前，文章在后；文章按 fetchedAt 倒序
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
}

/**
 * 移动文章或文件夹到目标分类文件夹
 */
export async function moveArticleItem(
  workspacePath: string,
  sourceRelPath: string,
  targetFolderRelPath: string
): Promise<void> {
  const sourceAbsPath = path.join(workspacePath, sourceRelPath);
  const targetFolderAbsPath = path.join(workspacePath, targetFolderRelPath);
  const itemName = path.basename(sourceAbsPath);
  const targetAbsPath = path.join(targetFolderAbsPath, itemName);
  await fs.rename(sourceAbsPath, targetAbsPath);
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
  await fs.rename(oldAbsPath, newAbsPath);
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
}
