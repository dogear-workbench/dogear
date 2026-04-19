// electron/main/tipc/article.ts
import path from 'path';
import fs from 'fs/promises';
import { BrowserWindow } from 'electron';
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { v4 as uuidv4 } from 'uuid';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import * as articleService from '../services/article-service.js';
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
    parseStatus: 'script_ok' | 'fixed' | 'ai_parsing' | 'ai_enhanced' | 'quality_warning' | 'failed';
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
 */
async function appendParseHistoryEntry(entry: Record<string, unknown>) {
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

export const articleRouter = {
  /**
   * 解析网络文章并保存到工作区（V2 主流程）
   *
   * 优先级：
   *   1. 平台脚本（Python）— 零 AI，最快
   *   2. Readability — 本地 HTML 解析
   *   3. AI 兜底 — 两者均失败时创建 stub 并提交 Agent 任务
   */
  parseArticle: t.procedure
    .input<{ url: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = await workspaceJsonService.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };

        // 1. 一次性抓取原始 HTML（平台脚本和 Readability 共用，避免重复请求）
        let rawHtml: string;
        try {
          rawHtml = await articleService.fetchRawHtml(input.url);
        } catch (fetchError) {
          return { error: `抓取失败: ${fetchError}` };
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
            durationMs: 0,
          });
          return { article: result.meta };
        } catch (err) {
          readabilityError = String(err);
        }

        // 4. 两者均失败 → 创建 stub 并提交 AI 任务
        const articleId = uuidv4();
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
          readabilityError,
        });

        void appendParseHistoryEntry({
          timestamp: new Date().toISOString(),
          articleId,
          url: input.url,
          platform,
          trigger,
          triggeredAi: true,
          parseStatus: 'ai_parsing',
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
};
