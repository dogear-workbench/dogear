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
  isBrowserRetryableFetchError,
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
  getArticle,
  updateArticleParseStatus,
  deleteArticle,
} from './article/crud.js';

export {
  listArticleTree,
  createArticleFolder,
  moveArticleItem,
  renameArticleFolder,
  deleteArticleFolder,
} from './article/tree.js';
