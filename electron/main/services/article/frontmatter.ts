/**
 * 文章 md 文件的 frontmatter 读写原语（YAML 兼容子集，零依赖，notes-store 解析思路）
 *
 * 文章格式：一文一 md（frontmatter 承载元数据 + 正文 markdown）+ 伴随 <slug>.raw.html；
 * id 是稳定标识（UUID 内嵌 frontmatter），文件名/文件夹可自由改名。
 * 字符串值含特殊字符时用双引号包裹（JSON 字符串转义，是合法 YAML 双引号标量，\n \u 语义一致）。
 */
import path from 'node:path';
import type { ArticleMeta } from './types.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** 序列化 frontmatter 文本（不含正文，末尾带空行衔接正文） */
export function serializeFrontmatter(meta: ArticleMeta): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${quoteIfNeeded(meta.id)}`);
  lines.push(`url: ${quoteIfNeeded(meta.url)}`);
  lines.push(`title: ${quoteIfNeeded(meta.title)}`);
  if (meta.author !== null) lines.push(`author: ${quoteIfNeeded(meta.author)}`);
  if (meta.siteName !== null) lines.push(`siteName: ${quoteIfNeeded(meta.siteName)}`);
  if (meta.excerpt !== null) lines.push(`excerpt: ${quoteIfNeeded(meta.excerpt)}`);
  lines.push(`wordCount: ${meta.wordCount}`);
  lines.push(`fetchedAt: ${meta.fetchedAt}`);
  if (meta.language !== null) lines.push(`language: ${quoteIfNeeded(meta.language)}`);
  if (meta.parseStatus) lines.push(`parseStatus: ${meta.parseStatus}`);
  lines.push('---', '');
  return lines.join('\n') + '\n';
}

export interface ParsedArticleFile {
  meta: ArticleMeta;
  content: string;
}

/** 解析文章 md 原文；无 frontmatter / 缺少 id+url 核心字段返回 null（调用方按普通文件降级处理） */
export function parseArticleFile(raw: string): ParsedArticleFile | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;
  const meta: ArticleMeta = {
    id: '',
    url: '',
    title: '',
    author: null,
    siteName: null,
    excerpt: null,
    wordCount: 0,
    fetchedAt: 0,
    language: null,
  };
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();
    switch (key) {
      case 'id': meta.id = parseString(rawValue); break;
      case 'url': meta.url = parseString(rawValue); break;
      case 'title': meta.title = parseString(rawValue); break;
      case 'author': meta.author = parseStringOrNull(rawValue); break;
      case 'siteName': meta.siteName = parseStringOrNull(rawValue); break;
      case 'excerpt': meta.excerpt = parseStringOrNull(rawValue); break;
      case 'wordCount': meta.wordCount = Number(rawValue) || 0; break;
      case 'fetchedAt': meta.fetchedAt = Number(rawValue) || 0; break;
      case 'language': meta.language = parseStringOrNull(rawValue); break;
      case 'parseStatus': meta.parseStatus = parseString(rawValue) as ArticleMeta['parseStatus']; break;
    }
  }
  if (!meta.id || !meta.url) return null;
  return { meta, content: match[2] };
}

/** 标题转安全文件名（保留中文原字符；Windows 非法字符与控制字符替换为空格，收尾清理，截断 80） */
export function buildArticleSlug(title: string): string {
  let s = (title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');
  if (!s) s = 'untitled';
  if (s.length > 80) s = s.slice(0, 80).trimEnd();
  return s;
}

/** 同目录 slug 冲突消解：<slug>.md 已被其他 id 占用时换 -2/-3 尾缀；同 id 视为重写覆盖 */
export async function resolveSlugConflict(
  dir: string,
  slug: string,
  articleId: string,
  readIdAt: (mdPath: string) => Promise<string | null>,
): Promise<string> {
  let candidate = slug;
  for (let n = 2; n < 1000; n++) {
    const mdPath = path.join(dir, `${candidate}.md`);
    try {
      await fsAccess(mdPath);
    } catch {
      return candidate;
    }
    const existingId = await readIdAt(mdPath);
    if (existingId === articleId) return candidate;
    candidate = `${slug}-${n}`;
  }
  return `${slug}-${Date.now()}`;
}

function fsAccess(p: string): Promise<void> {
  return import('node:fs/promises').then((fs) => fs.access(p));
}

function parseString(rawValue: string): string {
  return stripQuotes(rawValue);
}

function parseStringOrNull(rawValue: string): string | null {
  const v = stripQuotes(rawValue);
  return v === '' || v === 'null' ? null : v;
}

function stripQuotes(s: string): string {
  const first = s[0];
  const last = s[s.length - 1];
  if (first === '"' && last === '"') {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  if (first === "'" && last === "'") return s.slice(1, -1);
  return s;
}

function quoteIfNeeded(s: string): string {
  if (s === '') return '""';
  const unsafe =
    /[:#\[\]"'\\，]/.test(s) ||
    /[\u0000-\u001f]/.test(s) ||
    s !== s.trim() ||
    /^[-?!&*]|^(0x)?\d+$/.test(s) ||
    s === 'null' || s === 'true' || s === 'false';
  return unsafe ? JSON.stringify(s) : s;
}
