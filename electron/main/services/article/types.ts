/**
 * 网络文章解析服务共享类型与常量
 */
import path from 'node:path';

/** 文章解析状态（与 types/article.ts 的 ArticleParseStatus 保持一致） */
export type ArticleParseStatus =
  | 'script_ok'        // 新增：平台脚本解析成功（零 AI）
  | 'fixed'
  | 'ai_parsing'
  | 'ai_enhanced'
  | 'quality_warning'
  | 'failed';

/** 解析路径标记（parse history 的 layer 字段，与成功态枚举解耦） */
export type ArticleParseLayer =
  | 'script'
  | 'readability'
  | 'ai'
  | 'fetch_fail'
  | 'duplicated';

/** 文章元数据（内嵌 md 文件 frontmatter） */
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

/** 文章库相对前缀：树节点 path 与物理位置统一为工作区相对路径 {workspacePath}/dogear/articles */
export const ARTICLES_DIR = 'dogear/articles';

/** 文章库物理根：{workspacePath}/dogear/articles */
export function getArticlesRoot(workspacePath: string): string {
  return path.join(workspacePath, ...ARTICLES_DIR.split('/'));
}

/** relPath 是否落在文章库内（前端分区判定同语义） */
export function isArticlesRelPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  return norm === ARTICLES_DIR || norm.startsWith(ARTICLES_DIR + '/');
}
