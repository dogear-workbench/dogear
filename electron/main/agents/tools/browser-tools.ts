/**
 * 内嵌浏览器 MCP Server 工具（声明式入口）
 *
 * readArticle/search 为快档入口：内嵌后台 tab 加载 → 就地解析，失败时页面保留在 tab
 * 并返回结构化位置（tabId/URL/pageState），agent 用原子工具继续探索。
 * 原子探索与操作工具拆分在 browser-atom-tools.ts（观察类）与 browser-action-tools.ts（操作类），
 * 全部走内嵌宿主，ref = backendNodeId@generation。错误一律 isError 不抛。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import type { BrowserTaskMeta } from '../../services/browser/browser-task-meta.js';
import { readArticleWithBrowser } from '../../services/browser/browser-article-service.js';
import type { BrowserArticleActionEvent } from '../../services/browser/browser-article-types.js';
import { controlledBrowserBlock } from '../../services/browser/site-policy.js';
import { searchWeb } from '../../services/browser/browser-search-service.js';
import type { SearchActionEvent } from '../../services/browser/browser-search-types.js';
import { loadSettings } from '../../services/settings-service.js';
import { saveArticleFromScript } from '../../services/article-service.js';
import {
  buildTaskMeta,
  createAgentTabRunner,
  emitAction,
  formatFetchFailure,
  forwardArticleAction,
  forwardSearchAction,
  isErrorResult,
  textResult,
  withTimeout,
  SEARCH_ENGINE_LABELS,
} from './browser-tool-shared.js';
import { createBrowserObserveToolDefs } from './browser-atom-tools.js';
import { createBrowserActionToolDefs } from './browser-action-tools.js';
import { createPresentToolDef } from './browser-present-tool.js';
import { raiseHumanIntervention } from '../../services/browser/human-intervention.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

const SCREENSHOT_TIMEOUT_MS = 10_000;

export function createBrowserToolDefs(opts?: {
  conversationId?: string;
  workspacePath?: string;
  workspaceId?: string;
}): ToolDef[] {
  const conversationId = opts?.conversationId;
  const workspacePath = opts?.workspacePath;
  const meta = () => buildTaskMeta(conversationId);

  return [
    // ========================================
    // 工具 1: 读取文章（声明式，首选入口）
    // ========================================
    defineTool(
      'dogear__browser__readArticle',
      '用浏览器读取网页文章（快档首选）',
      '通过内嵌浏览器读取网页文章，返回渲染后的 Markdown 正文与元数据。内置渲染等待、展开全文按钮点击、翻页拼接与登录墙检测。\n' +
        '使用纪律：\n' +
        '- 需要读取网页文章内容时优先调用本工具，不要直接从原子工具开始。\n' +
        '- 快档失败（timeout / parse_empty / nav_failed）时不白跑：返回附页面位置（tabId + URL + 状态），页面保留在标签页中，直接用 dogear__browser__observe_page / read_text 继续探索，不要重新导航。\n' +
        '- 小红书等登录态站点禁止本通道（调用会被直接拒绝），请改用 dogear__extension__* 扩展通道在用户真实浏览器上操作。\n' +
        '- 返回 need_login 时：页面已保留在内嵌浏览器并呈现在浏览器面板，等待人工状态已产生；必须告知用户「请在浏览器面板完成登录，登录完成后告诉我重试」；用户完成后重新调用本工具即可（登录态已持久化）。\n' +
        '- 结果附质量信号：正文可能不完整时会给出提示，可据此建议用户核对原文。',
      z.object({
        url: z.string().url().describe('文章页面完整 URL（含 http/https）'),
      }),
      async (args) => {
        const taskMeta = meta();
        const blocked = controlledBrowserBlock(args.url);
        if (blocked) {
          emitAction({ source: 'readArticle', taskMeta, action: 'parse', url: args.url, detail: blocked, result: 'site_forbidden' });
          return isErrorResult(blocked);
        }
        const result = await readArticleWithBrowser(args.url, {
          taskMeta,
          onAction: forwardArticleAction,
          workspaceId: opts?.workspaceId,
        });
        if (!result.ok) {
          emitAction({
            source: 'readArticle',
            taskMeta,
            action: 'parse',
            url: args.url,
            detail: result.message,
            result: result.errorClass,
          });
          if (result.errorClass === 'need_login') {
            if (result.failure?.tabId) {
              raiseHumanIntervention({
                tabId: result.failure.tabId,
                reason: 'login_required',
                message: `页面需要登录后才能读取：${result.failure.url ?? args.url}。请在浏览器面板完成登录后点「完成后继续」`,
                url: result.failure.url ?? args.url,
                taskMeta,
              });
            }
            return isErrorResult(
              `读取失败：页面需要登录（need_login）。\n` +
                `页面已保留在内嵌浏览器并呈现在浏览器面板（${result.failure?.url ?? args.url}）。\n` +
                `已产生「等待人工」状态：请告知用户在浏览器面板完成登录后点「完成后继续」，或登录完成后让你重试即可。`,
            );
          }
          return isErrorResult(formatFetchFailure('读取文章', result.errorClass, result.message, result.failure));
        }
        const article = result.meta;
        emitAction({
          source: 'readArticle',
          taskMeta,
          action: 'parse',
          url: article.url,
          detail: `解析成功：${article.title}`,
          result: `wordCount=${article.wordCount}`,
        });
        const header =
          `📄 文章读取成功\n` +
          `标题: ${article.title}\n` +
          `作者: ${article.author || '未知'}\n` +
          `来源: ${article.siteName || '未知'}\n` +
          `最终 URL: ${article.url}\n` +
          `字数: ${article.wordCount}` +
          (article.qualityHint ? `\n⚠️ 质量提示：${article.qualityHint}` : '');
        return textResult(`${header}\n\n--- 正文 ---\n\n${article.content}`);
      },
    ),

    // ========================================
    // 工具 2: 网页搜索（声明式，发现入口）
    // ========================================
    defineTool(
      'dogear__browser__search',
      '搜索网页并返回结果列表（快档）',
      '通过内嵌浏览器在搜索引擎搜索关键词，返回结构化结果列表（标题 / URL / 摘要）。快档解析，引擎链 Google → DuckDuckGo → Bing 自动降级，引擎与代理在设置页「基础设置 → 浏览器」配置。\n' +
        '传 site="reddit" 或 site="zhihu" 时走站内搜索：reddit 用 old.reddit（结果带 score/评论数/subreddit），zhihu 用知乎搜索页（结果带作者/赞同数）；站内失败自动降级为「关键词 site:域名」通用搜索（丢互动量但保可用，降级原因见返回）。\n' +
        '使用纪律：\n' +
        '- 需要发现内容（不知道具体 URL）时先用本工具搜索，搜到再用 dogear__browser__readArticle 阅读。\n' +
        '- 需要站内互动量排序（高赞/高票）或某个站的垂直内容时传 site；不传 site 走通用引擎，行为不变。\n' +
        '- 关键词用空格分隔核心词，避免整句提问，与普通搜索引擎用法一致。\n' +
        '- 全链失败时页面保留在标签页并返回位置（tabId + URL + 状态），直接用 dogear__browser__observe_page / read_text 从该页面手动提取结果，不要重新搜索。\n' +
        '- 站内搜索对登录态敏感：知乎未登录可能返回空结果，Reddit 未登录会跳登录页；降级原因提到登录或空结果时，提示用户在浏览器面板人工登录对应站点一次（profile 会记住）后重试。\n' +
        '- 返回降级提示且提到验证页时，告知用户可在浏览器面板人工完成一次验证（profile 会记住）后重试。',
      z.object({
        query: z.string().trim().min(1).describe('搜索关键词，不能为空'),
        site: z.enum(['reddit', 'zhihu']).optional().describe('站内搜索引擎：需要站内互动量排序（高赞/高票）时用它；不传走通用引擎'),
        maxResults: z.number().int().min(1).max(15).optional().describe('返回结果条数上限（1-15），默认 8'),
      }),
      async (args) => {
        const taskMeta = meta();
        const settings = await loadSettings();
        const outcome = await searchWeb(args.query, {
          engine: settings.browserSearchEngine,
          site: args.site,
          maxResults: args.maxResults,
          proxyServer: settings.browserProxyServer,
          taskMeta,
          onAction: forwardSearchAction,
          workspaceId: opts?.workspaceId,
        });
        if (!outcome.ok) {
          emitAction({
            source: 'search',
            taskMeta,
            action: 'parse',
            detail: outcome.message,
            result: outcome.errorClass,
          });
          return isErrorResult(formatFetchFailure('搜索', outcome.errorClass, outcome.message, outcome.failure));
        }
        const lines = outcome.results.map(
          (r) => `${r.rank}. ${r.title}\n   ${r.url}\n   ${r.snippet}${r.meta ? `\n   ${r.meta}` : ''}`,
        );
        const degradeNote =
          outcome.degradations.length > 0
            ? `\n⚠️ 降级记录：${outcome.degradations
                .map((d) => `${SEARCH_ENGINE_LABELS[d.from]} → ${SEARCH_ENGINE_LABELS[d.to]}（${d.reason}）`)
                .join('；')}\n如涉及验证页，可在浏览器面板人工完成一次验证，profile 会记住。`
            : '';
        return textResult(
          `🔍 搜索完成\n引擎: ${SEARCH_ENGINE_LABELS[outcome.engine]}\n关键词: ${outcome.query}\n结果数: ${outcome.results.length}${degradeNote}\n\n${lines.join('\n\n')}`,
        );
      },
    ),

    // ========================================
    // 工具 3: 文章入库
    // ========================================
    defineTool(
      'dogear__browser__save_article',
      '把网页文章保存到工作区文章库',
      '把已获取的文章内容保存为工作区文章（写入 meta 与 Markdown 正文，出现在文章列表中）。' +
        '典型场景：用浏览器工具读取网页全文后入库，闭环「读 → 存」。title/url/content 为必填。',
      z.object({
        title: z.string().trim().min(1).describe('文章标题'),
        url: z.string().url().describe('文章来源 URL'),
        content: z.string().trim().min(1).describe('文章 Markdown 正文'),
        author: z.string().optional().describe('作者（未知则不传）'),
        siteName: z.string().optional().describe('站点名（未知则不传）'),
        excerpt: z.string().optional().describe('摘要（未知则不传）'),
      }),
      async (args) => {
        const taskMeta = meta();
        try {
          if (!workspacePath) {
            return isErrorResult('保存失败：当前会话未关联工作区，无法入库');
          }
          const article = await saveArticleFromScript({
            workspacePath,
            url: args.url,
            rawHtml: '',
            title: args.title,
            content: args.content,
            author: args.author ?? null,
            siteName: args.siteName ?? null,
            excerpt: args.excerpt ?? null,
            language: null,
          });
          emitAction({
            source: 'save_article',
            taskMeta,
            action: 'parse',
            url: args.url,
            detail: args.title,
            result: `id=${article.id} wordCount=${article.wordCount}`,
          });
          return textResult(`已入库：${article.title}（${article.wordCount} 字，id ${article.id}）`);
        } catch (err) {
          emitAction({ source: 'save_article', taskMeta, action: 'parse', url: args.url, result: 'error' });
          return isErrorResult(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        }
      },
    ),

    // ========================================
    // 工具 4: 结束浏览器任务
    // ========================================
    defineTool(
      'dogear__browser__close',
      '结束浏览器任务（通常无需调用）',
      '声明浏览器探索任务结束，清空元素引用。浏览器实例本身由空闲策略自动关闭（默认 3 分钟），一般无需显式调用本工具。',
      z.object({}),
      async () => {
        emitAction({ source: 'close', taskMeta: meta(), action: 'close', result: 'ok' });
        return textResult(
          '已声明浏览器探索任务结束。浏览器实例会在空闲约 3 分钟后自动回收，无需其他操作；再次需要时直接调用工具即可。',
        );
      },
    ),

    // ========================================
    // 工具 5: 截图（内嵌宿主）
    // ========================================
    defineTool(
      'dogear__browser__screenshot',
      '截取当前页面截图',
      '对内嵌浏览器当前页面截取视口截图，保存为临时 PNG 文件并返回路径。查看图片：把返回的路径传给 Read 工具即可（Read 原生支持图片附件）。',
      z.object({}),
      async () => {
        const taskMeta = meta();
        emitAction({ source: 'screenshot', taskMeta, action: 'screenshot' });
        const withAgentTab = createAgentTabRunner(opts?.workspaceId, conversationId ?? 'browser-tools');
        const r = await withAgentTab(async (tab) => {
          const image = await withTimeout(`截图（${SCREENSHOT_TIMEOUT_MS / 1000}s 上限）`, SCREENSHOT_TIMEOUT_MS, () =>
            tab.view.webContents.capturePage(),
          );
          const file = path.join(os.tmpdir(), `dogear-browser-${Date.now()}.png`);
          await fs.promises.writeFile(file, image.toPNG());
          return { file, url: tab.url };
        });
        if (!r.ok) {
          emitAction({ source: 'screenshot', taskMeta, action: 'screenshot', result: 'error' });
          return isErrorResult(`截图失败：${r.message}`);
        }
        emitAction({ source: 'screenshot', taskMeta, action: 'screenshot', url: r.value.url, result: r.value.file });
        return textResult(`截图已保存: ${r.value.file}
用 Read 工具读取该路径即可查看图片。`);
      },
    ),

    ...createBrowserObserveToolDefs({
      conversationId,
      workspaceId: opts?.workspaceId,
      workspacePath,
    }),

    createPresentToolDef({
      conversationId,
      workspaceId: opts?.workspaceId,
    }),

    ...createBrowserActionToolDefs({
      conversationId,
      workspaceId: opts?.workspaceId,
    }),
  ];
}

registerToolGroup({
  server: 'dogear-browser',
  label: '浏览器',
  create: createBrowserToolDefs,
  placeholder: [{}],
});
