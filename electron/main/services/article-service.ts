/**
 * 网络文章解析服务 facade
 * 实现拆分在 services/article/ 目录，此处 re-export 保持引用方 import 路径不变
 */
export type {
  ArticleParseStatus,
  ArticleParseLayer,
  ArticleMeta,
  Article,
} from './article/types.js';

export {
  detectPlatform,
  FetchError,
  fetchRawHtml,
  tryPlatformScript,
} from './article/fetch.js';
export type { ScriptParseAttempt } from './article/fetch.js';

export {
  parseArticleDocument,
  parseArticleHtml,
  fetchAndParseArticle,
} from './article/parse.js';
export type { ParsedArticleData } from './article/parse.js';

export {
  saveArticle,
  saveArticleFromScript,
  saveRawHtmlStub,
  listArticles,
  getArticleWithRelPath,
  getArticleFileByRelPath,
  updateArticleParseStatus,
  deleteArticleEntry,
  deleteArticleFileByRelPath,
  renameArticleFileWithCompanion,
  moveArticleFileWithCompanion,
} from './article/crud.js';

export { ARTICLES_DIR, getArticlesRoot, isArticlesRelPath } from './article/types.js';

export {
  runParseArticlePipeline,
  type ArticleParseSource,
  type ArticleParseDetail,
  type ArticleParsePipelineResult,
} from './article/pipeline.js';
