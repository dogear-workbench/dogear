/**
 * 网络文章解析服务共享类型与常量
 */

/** 文章解析状态（与 types/article.ts 的 ArticleParseStatus 保持一致） */
export type ArticleParseStatus =
  | 'script_ok'        // 新增：平台脚本解析成功（零 AI）
  | 'fixed'
  | 'need_login'
  | 'ai_parsing'
  | 'ai_enhanced'
  | 'quality_warning'
  | 'failed';

/** 解析路径标记（parse history 的 layer 字段，与成功态枚举解耦） */
export type ArticleParseLayer =
  | 'script'
  | 'readability'
  | 'browser'
  | 'ai'
  | 'fetch_fail_browser'
  | 'fetch_fail';

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

/** 文章存储根目录名 */
export const ARTICLES_DIR = '.dogear/articles';

/** 文章排序索引文件名 */
export const ORDER_FILE = '.order.json';
