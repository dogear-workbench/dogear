/**
 * 网络文章解析管线（DOM 预处理 → Readability → Turndown）
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { v4 as uuidv4 } from 'uuid';
import { detectPlatform, fetchRawHtml } from './fetch.js';
import type { ArticleMeta } from './types.js';

// Turndown 实例（HTML → Markdown 转换器）
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

/** 解析纯函数输出（不含 id / url / fetchedAt / parseStatus 等存储层字段） */
export interface ParsedArticleData {
  title: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  wordCount: number;
  language: string | null;
  content: string;
}

type LinkedomDocument = ReturnType<typeof parseHTML>['document'];

/**
 * 核心解析管线：DOM 预处理 → Readability → Turndown → 结果组装
 * rawHtml 需与 document 同源（微信短内容正则从原始 HTML 提取）；解析失败抛错
 */
export function parseArticleDocument(params: {
  document: LinkedomDocument;
  rawHtml: string;
  url: string;
}): ParsedArticleData {
  const { document, rawHtml: html, url } = params;

  // 预处理：移除隐藏样式（微信公众号等平台通过 JS 控制内容可见性，
  // 静态解析时内容 div 带有 visibility:hidden/display:none，需要移除）
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

  // 预处理：懒加载图片（微信等平台用 data-src 代替 src 实现懒加载，
  // 需要将 data-src 复制到 src，否则 Readability/Turndown 无法识别图片）
  const lazyImages = document.querySelectorAll('img[data-src]');
  for (const img of lazyImages) {
    const dataSrc = img.getAttribute('data-src');
    if (dataSrc) {
      img.setAttribute('src', dataSrc);
    }
  }

  const reader = new Readability(document);
  const article = reader.parse();

  // 微信短内容（随笔）正文不在 DOM 中，嵌在 JS 变量 text_page_info.content 里
  const isWechat = detectPlatform(url) === 'wechat';
  let wechatShortContent: string | null = null;
  let wechatTitle: string | null = null;
  let wechatAuthor: string | null = null;

  if (isWechat) {
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
    const titleMatch = html.match(/window\.msg_title\s*=\s*window\.title\s*=\s*'([^']*)'/);
    if (titleMatch) {
      wechatTitle = titleMatch[1];
    }
    const authorMatch = html.match(/nick_name:\s*JsDecode\('([^']*)'\)/);
    if (authorMatch) {
      wechatAuthor = authorMatch[1];
    }
  }

  // 用 trim 后文本长度判断 Readability 是否有效，避免空白换行误判
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
    // 正文中的相对路径图片转换为绝对 URL
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

  return {
    title: finalTitle,
    author: finalAuthor,
    siteName: article?.siteName || (isWechat ? '微信公众平台' : null),
    excerpt: finalExcerpt,
    wordCount: finalWordCount,
    language: article?.lang || null,
    content: markdown,
  };
}

/** 便捷入口：输入 HTML 字符串，内部用 linkedom 解析后走 parseArticleDocument；containerHtml 提供时（扩展通道 readArticle 的 selector 容器）用它替换 body，让 Readability 聚焦该容器（微信短内容等 rawHtml 特判仍基于完整 html） */
export function parseArticleHtml(html: string, url: string, containerHtml?: string): ParsedArticleData {
  const { document } = parseHTML(html);
  if (containerHtml) {
    const body = document.createElement('body');
    body.innerHTML = containerHtml;
    if (document.body) {
      document.body.replaceWith(body);
    } else {
      document.documentElement.appendChild(body);
    }
  }
  return parseArticleDocument({ document, rawHtml: html, url });
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
    html = await fetchRawHtml(url);
  }

  // 2. DOM 预处理 + Readability + Turndown + 结果组装（核心管线已抽为纯函数）
  const parsed = parseArticleHtml(html, url);

  // 3. 组装结果
  const id = uuidv4();
  const meta: ArticleMeta = {
    id,
    url,
    title: parsed.title,
    author: parsed.author,
    siteName: parsed.siteName,
    excerpt: parsed.excerpt,
    wordCount: parsed.wordCount,
    fetchedAt: Date.now(),
    language: parsed.language,
    parseStatus: 'fixed',  // 初始：固定解析完成，尚未经过 AI 检查
  };

  return { meta, content: parsed.content, rawHtml: html };
}
