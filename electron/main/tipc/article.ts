// electron/main/tipc/article.ts
import path from 'path';
import fs from 'fs/promises';
import { BrowserWindow } from 'electron';
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { v4 as uuidv4 } from 'uuid';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import * as articleService from '../services/article-service.js';
import type { ArticleParseLayer } from '../services/article-service.js';
import { readArticleWithBrowser } from '../services/browser/browser-article-service.js';
import { recordBrowserAction } from '../services/browser/browser-action-stream.js';
import { getAgentManager } from '../agents/agent-manager.js';
import { TaskType, TaskStatus, type AgentTask, type ParseArticlePayload } from '../agents/task-types.js';
import { getArticleParserSkillsDir } from '../services/article-parser-skills-service.js';
import { withFileLock } from '../services/safe-json.js';
import type { RendererHandlers } from './renderer-handlers.js';

const t = tipc.create();

/**
 * 注册一次性全局监听：将 AgentManager 的 articleParseStatusChanged 事件
 * 广播到所有渲染窗口（主窗口 + 独立会话窗口都可能展示文章）。
 * 由 tipc/index.ts 在应用启动时调用。
 */
let listenerRegistered = false;
export function registerArticleParseStatusListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;

  getAgentManager().on('articleParseStatusChanged', (data: {
    articleId: string;
    workspacePath: string;
    parseStatus: 'script_ok' | 'fixed' | 'need_login' | 'ai_parsing' | 'ai_enhanced' | 'quality_warning' | 'failed';
  }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        const handlers = getRendererHandlers<RendererHandlers>(win.webContents);
        handlers.articleParseStatusChanged.send(data);
      } catch (err) {
        // 单个窗口失败不影响其他窗口
        console.warn('[article] 广播到窗口失败:', err);
      }
    }
  });
}

// ============================================================
// V2 主流程辅助函数
// ============================================================

/** 向所有渲染窗口广播登录墙事件（need_login 时调用，前端 toast + 条目状态） */
function broadcastBrowserLoginRequired(data: {
  articleId: string;
  url: string;
  workspaceId: string;
}) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      getRendererHandlers<RendererHandlers>(win.webContents).browserLoginRequired.send(data);
    } catch (err) {
      console.warn('[article] 广播登录墙事件到窗口失败:', err);
    }
  }
}

/**
 * 将 AI 解析任务提交到 AgentManager Worker 池。
 * fire-and-forget：失败只打印警告，不 throw。
 */
function submitAiParseTask(params: {
  articleId: string;
  articleDir: string;
  workspacePath: string;
  url: string;
  platform: string | null;
  trigger: 'script_failed' | 'parse_failed' | 'user_requested';
  scriptError?: { type: string; message: string };
  readabilityError?: string;
}) {
  try {
    const skillsDir = getArticleParserSkillsDir();
    const payload: ParseArticlePayload = {
      articleId: params.articleId,
      articleDir: params.articleDir,
      workspacePath: params.workspacePath,
      url: params.url,
      skillsDir,
      platform: params.platform,
      trigger: params.trigger,
      scriptError: params.scriptError,
      readabilityError: params.readabilityError,
      fixedParseSuccess: false,
    };
    const task: AgentTask = {
      id: uuidv4(),
      type: TaskType.PARSE_ARTICLE,
      status: TaskStatus.PENDING,
      payload,
      createdAt: Date.now(),
    };
    void getAgentManager().submitTask(task).catch((err) => {
      console.warn('[article] 提交 PARSE_ARTICLE 任务失败:', err);
    });
  } catch (err) {
    console.warn('[article] 准备 PARSE_ARTICLE 任务失败:', err);
  }
}

/**
 * 向解析历史 JSONL 文件追加一条记录（不阻塞主流程）。
 * layer 标记本次解析发生在哪一层：script / readability / browser / ai。
 */
interface ParseHistoryRecord {
  timestamp: string;
  articleId: string;
  url: string;
  platform: string | null;
  trigger: 'auto' | 'script_failed' | 'parse_failed' | 'user_requested';
  triggeredAi: boolean;
  parseStatus: string;
  layer: ArticleParseLayer;
  browserError?: string;
  readabilityError?: string;
  fetchError?: string;
  durationMs: number;
}

async function appendParseHistoryEntry(entry: ParseHistoryRecord) {
  try {
    const skillsDir = getArticleParserSkillsDir();
    const historyPath = path.join(skillsDir, 'history.jsonl');
    const line = JSON.stringify(entry) + '\n';
    await withFileLock(historyPath, async () => {
      await fs.appendFile(historyPath, line, 'utf-8');
    });
  } catch {
    // history write failure should never block main flow
  }
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** FetchError 摘要：错误描述后附结构化字段，便于排查与历史检索 */
function describeFetchError(err: unknown): string {
  if (err instanceof articleService.FetchError) {
    const fields = [
      err.status !== undefined ? `status=${err.status}` : null,
      err.code !== undefined ? `code=${err.code}` : null,
    ].filter(Boolean).join(' ');
    return `抓取失败: ${err.message}${fields ? `（${fields}）` : ''}`;
  }
  return `抓取失败: ${String(err)}`;
}

/**
 * 浏览器层编排（fetch 成功后的静态解析兜底与 fetch 白名单分流共用）：
 * 调用 readArticleWithBrowser，成功落盘、need_login 走人工流程；
 * 失败只返回结果不记 history，由调用方决定后续（提 AI / 直接报错）。
 */
async function runBrowserArticleStage(params: {
  url: string;
  workspaceId: string;
  workspacePath: string;
  platform: string | null;
  rawHtml: string | null;
  articleId: string;
  historyLayer: Extract<ArticleParseLayer, 'browser' | 'fetch_fail_browser'>;
}): Promise<
  | { kind: 'ok'; article: articleService.ArticleMeta }
  | { kind: 'need_login'; article: articleService.ArticleMeta }
  | { kind: 'failed'; errorClass: string; message: string }
> {
  const browserResult = await readArticleWithBrowser(params.url, {
    taskMeta: { kind: 'article', articleId: params.articleId },
    onAction: (event) => {
      recordBrowserAction({ source: 'parseArticle', ...event });
    },
  });

  if (browserResult.ok) {
    // 展开失败时 service 已把提示拼进 excerpt，状态用 quality_warning 标记正文可能不完整
    const parseStatus = browserResult.meta.qualityHint
      ? ('quality_warning' as const)
      : ('fixed' as const);
    const meta: articleService.ArticleMeta = {
      id: params.articleId,
      url: browserResult.meta.url,
      title: browserResult.meta.title,
      author: browserResult.meta.author,
      siteName: browserResult.meta.siteName,
      excerpt: browserResult.meta.excerpt,
      wordCount: browserResult.meta.wordCount,
      fetchedAt: Date.now(),
      language: browserResult.meta.language,
      parseStatus,
    };
    await articleService.saveArticle(params.workspacePath, {
      meta,
      content: browserResult.meta.content,
      ...(params.rawHtml !== null ? { rawHtml: params.rawHtml } : {}),
    });
    void appendParseHistoryEntry({
      timestamp: new Date().toISOString(),
      articleId: params.articleId,
      url: params.url,
      platform: params.platform,
      trigger: 'auto',
      triggeredAi: false,
      parseStatus,
      layer: params.historyLayer,
      durationMs: 0,
    });
    return { kind: 'ok', article: meta };
  }

  if (browserResult.errorClass === 'need_login') {
    const stubTitle = `需要登录：${hostOfUrl(params.url)}`;
    await articleService.saveRawHtmlStub({
      workspacePath: params.workspacePath,
      articleId: params.articleId,
      url: params.url,
      ...(params.rawHtml !== null ? { rawHtml: params.rawHtml } : {}),
      title: stubTitle,
      parseStatus: 'need_login',
    });
    broadcastBrowserLoginRequired({
      articleId: params.articleId,
      url: params.url,
      workspaceId: params.workspaceId,
    });
    void appendParseHistoryEntry({
      timestamp: new Date().toISOString(),
      articleId: params.articleId,
      url: params.url,
      platform: params.platform,
      trigger: 'auto',
      triggeredAi: false,
      parseStatus: 'need_login',
      layer: params.historyLayer,
      browserError: browserResult.message,
      durationMs: 0,
    });
    return {
      kind: 'need_login',
      article: {
        id: params.articleId,
        url: params.url,
        title: stubTitle,
        author: null,
        siteName: null,
        excerpt: null,
        wordCount: 0,
        fetchedAt: Date.now(),
        language: null,
        parseStatus: 'need_login',
      } as articleService.ArticleMeta,
    };
  }

  return { kind: 'failed', errorClass: browserResult.errorClass, message: browserResult.message };
}

/**
 * fetch 白名单失败分流：跳过平台脚本与 Readability（无 HTML 可用），直接进浏览器层。
 * 成功/need_login 正常返回；其余失败直接报错，不建 stub 不提 AI
 * （fetch 都拿不到的页面 AI 只能空壳硬猜）。
 */
async function parseArticleViaBrowserAfterFetchFail(
  input: { url: string; workspaceId: string },
  workspacePath: string,
): Promise<{ article: articleService.ArticleMeta } | { error: string }> {
  const articleId = uuidv4();
  const platform = articleService.detectPlatform(input.url);
  const outcome = await runBrowserArticleStage({
    url: input.url,
    workspaceId: input.workspaceId,
    workspacePath,
    platform,
    rawHtml: null,
    articleId,
    historyLayer: 'fetch_fail_browser',
  });
  if (outcome.kind !== 'failed') {
    return { article: outcome.article };
  }
  void appendParseHistoryEntry({
    timestamp: new Date().toISOString(),
    articleId,
    url: input.url,
    platform,
    trigger: 'auto',
    triggeredAi: false,
    parseStatus: 'failed',
    layer: 'fetch_fail_browser',
    browserError: outcome.message,
    durationMs: 0,
  });
  return { error: `浏览器解析失败（${outcome.errorClass}）：${outcome.message}` };
}

export const articleRouter = {
  /**
   * 解析网络文章并保存到工作区（V2 主流程）
   *
   * 优先级：
   *   1. 平台脚本（Python）— 零 AI，最快
   *   2. Readability — 本地 HTML 解析
   *   3. 浏览器渲染解析 — 静态解析失败时的兜底；登录墙走人工流程
   *   4. AI 兜底 — 浏览器也失败时创建 stub 并提交 Agent 任务
   */
  parseArticle: t.procedure
    .input<{ url: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        // 1. 一次性抓取原始 HTML（平台脚本和 Readability 共用，避免重复请求）；
        // 轻反爬类失败（403/429/503/超时/连接重置）分流进浏览器层
        let rawHtml: string;
        try {
          rawHtml = await articleService.fetchRawHtml(input.url);
        } catch (fetchError) {
          if (!articleService.isBrowserRetryableFetchError(fetchError)) {
            const message = describeFetchError(fetchError);
            void appendParseHistoryEntry({
              timestamp: new Date().toISOString(),
              articleId: '',
              url: input.url,
              platform: articleService.detectPlatform(input.url),
              trigger: 'auto',
              triggeredAi: false,
              parseStatus: 'failed',
              layer: 'fetch_fail',
              fetchError: message,
              durationMs: 0,
            });
            return { error: message };
          }
          return await parseArticleViaBrowserAfterFetchFail(input, workspace.path);
        }

        const platform = articleService.detectPlatform(input.url);

        // 2. 尝试平台脚本（零 AI，最快路径）
        let scriptAttempt: articleService.ScriptParseAttempt | null = null;
        if (platform) {
          scriptAttempt = await articleService.tryPlatformScript({
            platform,
            url: input.url,
            html: rawHtml,
          });

          if (scriptAttempt.ok) {
            const meta = await articleService.saveArticleFromScript({
              workspacePath: workspace.path,
              url: input.url,
              rawHtml,
              title: scriptAttempt.title!,
              content: scriptAttempt.content!,
              author: scriptAttempt.author ?? null,
              siteName: scriptAttempt.siteName ?? null,
              excerpt: scriptAttempt.excerpt ?? null,
              language: scriptAttempt.language ?? null,
            });
            void appendParseHistoryEntry({
              timestamp: new Date().toISOString(),
              articleId: meta.id,
              url: input.url,
              platform,
              trigger: 'auto',
              triggeredAi: false,
              parseStatus: 'script_ok',
              layer: 'script',
              durationMs: scriptAttempt.durationMs,
            });
            return { article: meta };
          }
        }

        // 3. Readability 兜底
        let readabilityError: string | undefined;
        try {
          const result = await articleService.fetchAndParseArticle(input.url, { rawHtml });
          await articleService.saveArticle(workspace.path, result);
          void appendParseHistoryEntry({
            timestamp: new Date().toISOString(),
            articleId: result.meta.id,
            url: input.url,
            platform,
            trigger: 'auto',
            triggeredAi: false,
            parseStatus: 'fixed',
            layer: 'readability',
            durationMs: 0,
          });
          return { article: result.meta };
        } catch (err) {
          readabilityError = String(err);
        }

        // 3.5 浏览器渲染解析（need_login 走人工流程不走 AI，其余失败类继续交给 AI 兜底）
        const articleId = uuidv4();
        const outcome = await runBrowserArticleStage({
          url: input.url,
          workspaceId: input.workspaceId,
          workspacePath: workspace.path,
          platform,
          rawHtml,
          articleId,
          historyLayer: 'browser',
        });

        if (outcome.kind !== 'failed') {
          return { article: outcome.article };
        }

        // 4. 浏览器也失败（timeout/parse_empty/browser_crash）→ 创建 stub 并提交 AI 任务
        const browserFailureSuffix = `浏览器层失败：${outcome.message}`;
        const readabilityErrorWithBrowser = readabilityError
          ? `${readabilityError}；${browserFailureSuffix}`
          : browserFailureSuffix;
        const articleDir = await articleService.saveRawHtmlStub({
          workspacePath: workspace.path,
          articleId,
          url: input.url,
          rawHtml,
        });

        // 判断 AI 触发原因：脚本存在但失败 vs Readability 失败
        const trigger =
          scriptAttempt && !scriptAttempt.ok && scriptAttempt.errorType !== 'NoScript'
            ? ('script_failed' as const)
            : ('parse_failed' as const);

        submitAiParseTask({
          articleId,
          articleDir,
          workspacePath: workspace.path,
          url: input.url,
          platform,
          trigger,
          scriptError:
            scriptAttempt && !scriptAttempt.ok && scriptAttempt.errorType !== 'NoScript'
              ? { type: scriptAttempt.errorType ?? 'Unknown', message: scriptAttempt.errorMessage ?? '' }
              : undefined,
          readabilityError: readabilityErrorWithBrowser,
        });

        void appendParseHistoryEntry({
          timestamp: new Date().toISOString(),
          articleId,
          url: input.url,
          platform,
          trigger,
          triggeredAi: true,
          parseStatus: 'ai_parsing',
          layer: 'ai',
          readabilityError: readabilityErrorWithBrowser,
          durationMs: 0,
        });

        // 返回 stub meta，让前端立即显示"AI 解析中"状态
        return {
          article: {
            id: articleId,
            url: input.url,
            title: '(AI 解析中...)',
            author: null,
            siteName: null,
            excerpt: null,
            wordCount: 0,
            fetchedAt: Date.now(),
            language: null,
            parseStatus: 'ai_parsing',
          } as articleService.ArticleMeta,
        };
      } catch (error) {
        console.error('解析文章失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 获取工作区下所有文章列表
   */
  getArticles: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { articles: [], error: '工作区不存在' };

        const articles = await articleService.listArticles(workspace.path);
        return { articles };
      } catch (error) {
        console.error('获取文章列表失败:', error);
        return { articles: [], error: String(error) };
      }
    }),

  /**
   * 获取单篇文章的完整内容
   */
  getArticleDetail: t.procedure
    .input<{ workspaceId: string; articleId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        const article = await articleService.getArticle(workspace.path, input.articleId);
        return { article };
      } catch (error) {
        console.error('获取文章详情失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 删除文章
   */
  deleteArticle: t.procedure
    .input<{ workspaceId: string; articleId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        await articleService.deleteArticle(workspace.path, input.articleId);
        return { success: true };
      } catch (error) {
        console.error('删除文章失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 获取文章解析历史记录（最近 N 条，从 history.jsonl 读取）
   */
  getParseHistory: t.procedure
    .input<{ limit?: number }>()
    .action(async ({ input }) => {
      try {
        const limit = Math.min(input.limit ?? 50, 200);
        const skillsDir = getArticleParserSkillsDir();
        const historyPath = path.join(skillsDir, 'history.jsonl');
        const raw = await fs.readFile(historyPath, 'utf-8').catch(() => '');
        const lines = raw.split('\n').filter((l) => l.trim()).slice(-limit);
        const entries = lines.map((l) => {
          try { return JSON.parse(l); } catch { return { raw: l }; }
        });
        return { entries: entries.reverse() };  // most recent first
      } catch (error) {
        return { entries: [], error: String(error) };
      }
    }),
};
