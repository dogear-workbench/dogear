/**
 * 文章解析管线（URL → 抓取 → 平台脚本 → Readability → 入库；静态失败落 stub 并提交后台 AI 兜底）
 * 供 tipc（文件树手动导入）与 dogear__SaveArticle 工具共用
 */
import { v4 as uuidv4 } from 'uuid';
import { detectPlatform, fetchRawHtml, tryPlatformScript, FetchError, NON_HTML_RESOURCE_CODE } from './fetch.js';
import type { ScriptParseAttempt } from './fetch.js';
import { fetchAndParseArticle } from './parse.js';
import { saveArticle, saveArticleFromScript, saveRawHtmlStub, listArticles, deleteArticleEntry } from './crud.js';
import type { ArticleMeta, ArticleParseLayer, ArticleParseStatus } from './types.js';
import { submitAiParseTask, appendParseHistoryEntry } from './parse-ai-fallback.js';

/** 解析发起方：import = 文件树手动导入，agent = dogear__SaveArticle 工具（解析历史 trigger 记 user_requested） */
export type ArticleParseSource = 'import' | 'agent';

/** 管线同步返回的解析层明细（AI 兜底为后台异步，终态经 parseStatus 广播） */
export interface ArticleParseDetail {
  layer: ArticleParseLayer;
  parseStatus: ArticleParseStatus;
  platform: string | null;
  scriptName: string | null;
  triggeredAi: boolean;
  failureReason: string | null;
  duplicated?: boolean;
}

export interface ArticleParsePipelineResult {
  ok: boolean;
  error?: string;
  article?: ArticleMeta;
  /** 新入库文章的工作区相对路径（dogear/articles/...）；AI 兜底分支为占位文件路径 */
  articlePath?: string;
  detail?: ArticleParseDetail;
}

/** FetchError 摘要：错误描述后附结构化字段，便于排查与历史检索；非网页资源直接用原文案 */
function describeFetchError(err: unknown): string {
  if (err instanceof FetchError) {
    if (err.code === NON_HTML_RESOURCE_CODE) return err.message;
    const fields = [
      err.status !== undefined ? `status=${err.status}` : null,
      err.code !== undefined ? `code=${err.code}` : null,
    ].filter(Boolean).join(' ');
    return `抓取失败: ${err.message}${fields ? `（${fields}）` : ''}`;
  }
  return `抓取失败: ${String(err)}`;
}

/**
 * 运行文章解析管线（同步部分完成即返回；AI 兜底后台继续，parseStatus 照常广播）。
 * 行为与原 tipc parseArticle handler 一致，另在 detail 带回解析层信息供工具返回值使用。
 */
export async function runParseArticlePipeline(params: {
  workspaceId: string;
  workspacePath: string;
  url: string;
  source?: ArticleParseSource;
  /** 文章库内目标文件夹路径（支持多层，如 "技术/AI"）；AI 兜底占位条目不应用 */
  folder?: string;
}): Promise<ArticleParsePipelineResult> {
  const { workspaceId, workspacePath, url } = params;
  const historyTrigger = params.source === 'agent' ? ('user_requested' as const) : ('auto' as const);
  try {
    // 0. URL 去重（精确匹配）：已有非 failed 条目直接返回；failed 旧条目先删后重建
    const existing = (await listArticles(workspaceId, workspacePath)).find((a) => a.url === url);
    if (existing) {
      if (existing.parseStatus === 'failed') {
        await deleteArticleEntry(workspaceId, workspacePath, existing.id);
      } else {
        return {
          ok: true,
          article: existing,
          detail: {
            layer: 'duplicated',
            parseStatus: existing.parseStatus ?? 'fixed',
            platform: detectPlatform(url),
            scriptName: null,
            triggeredAi: false,
            failureReason: null,
            duplicated: true,
          },
        };
      }
    }

    // 1. 一次性抓取原始 HTML（平台脚本和 Readability 共用，避免重复请求）；
    // 抓取失败（反爬/超时/网络错误）直接报错——无 HTML 时静态解析与 AI 都无从下手
    let rawHtml: string;
    try {
      rawHtml = await fetchRawHtml(url);
    } catch (fetchError) {
      const message = describeFetchError(fetchError);
      void appendParseHistoryEntry({
        timestamp: new Date().toISOString(),
        articleId: '',
        url,
        platform: detectPlatform(url),
        trigger: historyTrigger,
        triggeredAi: false,
        parseStatus: 'failed',
        layer: 'fetch_fail',
        scriptUpdated: null,
        articleSaved: false,
        fetchError: message,
        durationMs: 0,
      });
      return {
        ok: false,
        error: message,
        detail: {
          layer: 'fetch_fail',
          parseStatus: 'failed',
          platform: detectPlatform(url),
          scriptName: null,
          triggeredAi: false,
          failureReason: message,
        },
      };
    }

    const platform = detectPlatform(url);

    // 2. 尝试平台脚本（零 AI，最快路径）
    let scriptAttempt: ScriptParseAttempt | null = null;
    if (platform) {
      scriptAttempt = await tryPlatformScript({ platform, url, html: rawHtml });

      if (scriptAttempt.ok) {
        const { meta, relPath } = await saveArticleFromScript({
          workspaceId,
          workspacePath,
          url,
          rawHtml,
          title: scriptAttempt.title!,
          content: scriptAttempt.content!,
          author: scriptAttempt.author ?? null,
          siteName: scriptAttempt.siteName ?? null,
          excerpt: scriptAttempt.excerpt ?? null,
          language: scriptAttempt.language ?? null,
          folder: params.folder,
        });
        void appendParseHistoryEntry({
          timestamp: new Date().toISOString(),
          articleId: meta.id,
          url,
          platform,
          trigger: historyTrigger,
          triggeredAi: false,
          parseStatus: 'script_ok',
          layer: 'script',
          scriptUpdated: null,
          articleSaved: true,
          durationMs: scriptAttempt.durationMs,
        });
        return {
          ok: true,
          article: meta,
          articlePath: relPath,
          detail: {
            layer: 'script',
            parseStatus: 'script_ok',
            platform,
            scriptName: `platforms/${platform}.py`,
            triggeredAi: false,
            failureReason: null,
          },
        };
      }
    }

    // 3. Readability 兜底
    let readabilityError: string | undefined;
    try {
      const result = await fetchAndParseArticle(url, { rawHtml });
      const relPath = await saveArticle(workspaceId, workspacePath, { ...result, folder: params.folder });
      void appendParseHistoryEntry({
        timestamp: new Date().toISOString(),
        articleId: result.meta.id,
        url,
        platform,
        trigger: historyTrigger,
        triggeredAi: false,
        parseStatus: 'fixed',
        layer: 'readability',
        scriptUpdated: null,
        articleSaved: true,
        durationMs: 0,
      });
      return {
        ok: true,
        article: result.meta,
        articlePath: relPath,
        detail: {
          layer: 'readability',
          parseStatus: 'fixed',
          platform,
          scriptName: null,
          triggeredAi: false,
          failureReason: null,
        },
      };
    } catch (err) {
      readabilityError = String(err);
    }

    // 4. AI 兜底：创建 stub 并提交 Agent 任务（前端立即显示"AI 解析中"状态）
    const articleId = uuidv4();
    const articlePath = await saveRawHtmlStub({
      workspaceId,
      workspacePath,
      articleId,
      url,
      rawHtml,
    });

    // 判断 AI 触发原因：脚本存在但失败 vs Readability 失败
    const trigger =
      scriptAttempt && !scriptAttempt.ok && scriptAttempt.errorType !== 'NoScript'
        ? ('script_failed' as const)
        : ('parse_failed' as const);

    const failureReason =
      trigger === 'script_failed'
        ? `平台脚本解析失败: ${scriptAttempt?.errorType ?? 'Unknown'} — ${scriptAttempt?.errorMessage ?? ''}`
        : readabilityError ?? '未知解析错误';

    void submitAiParseTask({
      articleId,
      articlePath,
      workspaceId,
      workspacePath,
      url,
      platform,
      trigger,
      scriptError:
        scriptAttempt && !scriptAttempt.ok && scriptAttempt.errorType !== 'NoScript'
          ? { type: scriptAttempt.errorType ?? 'Unknown', message: scriptAttempt.errorMessage ?? '' }
          : undefined,
      readabilityError,
    });

    void appendParseHistoryEntry({
      timestamp: new Date().toISOString(),
      articleId,
      url,
      platform,
      trigger: historyTrigger,
      triggeredAi: true,
      parseStatus: 'ai_parsing',
      layer: 'ai',
      scriptUpdated: null,
      articleSaved: false,
      readabilityError,
      durationMs: 0,
    });

    // 返回 stub meta，让前端立即显示"AI 解析中"状态
    return {
      ok: true,
      article: {
        id: articleId,
        url,
        title: '(AI 解析中...)',
        author: null,
        siteName: null,
        excerpt: null,
        wordCount: 0,
        fetchedAt: Date.now(),
        language: null,
        parseStatus: 'ai_parsing',
      },
      articlePath,
      detail: {
        layer: 'ai',
        parseStatus: 'ai_parsing',
        platform,
        scriptName:
          scriptAttempt && scriptAttempt.errorType !== 'NoScript' ? `platforms/${platform}.py` : null,
        triggeredAi: true,
        failureReason,
      },
    };
  } catch (error) {
    console.error('解析文章失败:', error);
    return { ok: false, error: String(error) };
  }
}
