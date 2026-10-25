/**
 * 扩展通道 Web 工具（纯 HTTP 搜索 + 文章入库）
 *
 * dogear__extension__search：主进程 net.fetch 直连搜索引擎，结构化返回结果列表，
 * 不依赖扩展连接，也不占扩展通道独占（不 acquireGate）；
 * dogear__extension__save_article：把已读取的文章内容写入工作区文章库，与 readArticle 配套。错误一律 isError 文案不抛异常。
 */

import { z } from 'zod';
import { searchWeb } from '../../services/browser/browser-search-service.js';
import type { SearchActionEvent } from '../../services/browser/browser-search-types.js';
import { listBlocked, toRegisteredDomain } from '../../services/browser/browser-blocklist-service.js';
import { loadSettings } from '../../services/settings-service.js';
import { saveArticleFromScript } from '../../services/article-service.js';
import { emitAction, isErrorResult, textResult } from './extension-command-shared.js';
import { createToolContext } from './extension-tool-context.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

export const SEARCH_ENGINE_LABELS: Record<string, string> = {
  google: 'Google',
  ddg: 'DuckDuckGo',
  bing: 'Bing',
  reddit: 'Reddit',
  zhihu: '知乎',
};

const SEARCH_FALLBACK_TAIL =
  '\n\n全链失败时可改用 dogear__extension__navigate 导航到 Bing 搜索结果页（https://cn.bing.com/search?q=关键词）兜底，再用 dogear__extension__observe_page / read_text 手动提取结果。';

export function createExtensionWebToolDefs(opts?: { conversationId?: string; workspaceId?: string; workspacePath?: string }): ToolDef[] {
  const ctx = createToolContext(opts);
  const { meta, emit, workspaceId, workspacePath } = ctx;

  return [
    defineTool(
      'dogear__extension__search',
      '搜索网页并返回结果列表（纯 HTTP，不占浏览器通道）',
      '主进程纯 HTTP 抓取搜索引擎结果页并结构化解析，返回标题 / URL / 摘要列表；不依赖扩展连接、不作用于浏览器页面、不受通道独占限制。' +
        '引擎链 Google（需代理）→ DuckDuckGo → Bing 自动降级，降级原因见返回。\n' +
        '传 site="reddit" 或 site="zhihu" 时走站内搜索（结果带互动量/作者等元信息）；站内失败自动降级为「关键词 site:域名」通用搜索。\n' +
        '使用纪律：\n' +
        '- 需要发现内容（不知道具体 URL）时先用本工具搜索；结果 URL 需要深度阅读时用 navigate 打开后 observe_page / read_text。\n' +
        '- 关键词用空格分隔核心词，避免整句提问，与普通搜索引擎用法一致。\n' +
        '- 纯 HTTP 无登录态与 JS 渲染：解析为空时引擎自动降级；全链失败时按返回指引导航搜索引擎页面兜底，不要盲目重试同一引擎。\n' +
        '- 站内搜索对登录态敏感：知乎未登录可能空结果、Reddit 未登录可能跳登录页，命中时以降级结果为准并如实告知用户。\n' +
        '- 结果已自动过滤用户屏蔽的站点，尾部会注明隐藏条数；不要试图绕过屏蔽去访问这些站点。',
      z.object({
        query: z.string().trim().min(1).describe('搜索关键词，不能为空'),
        site: z.enum(['reddit', 'zhihu']).optional().describe('站内搜索引擎：需要站内互动量排序（高赞/高票）时用它；不传走通用引擎'),
        max_results: z.number().int().min(1).max(15).optional().describe('返回结果条数上限（1-15），默认 8'),
      }),
      async (args) => {
        const taskMeta = meta();
        const settings = await loadSettings();
        const outcome = await searchWeb(args.query, {
          engine: settings.browserSearchEngine,
          site: args.site,
          maxResults: args.max_results,
          proxyServer: settings.browserProxyServer,
          taskMeta,
          onAction: (event: SearchActionEvent) =>
            emit(event.action, { url: event.url, detail: event.detail, result: event.result }),
        });
        if (!outcome.ok) {
          emit('parse', { detail: outcome.message, result: outcome.errorClass });
          return isErrorResult(`搜索失败（${outcome.errorClass}）：${outcome.message}${SEARCH_FALLBACK_TAIL}`);
        }
        const blockedDomains = new Set((await listBlocked()).map((b) => b.domain));
        const visible = outcome.results.filter((r) => {
          const domain = toRegisteredDomain(r.url);
          return !domain || !blockedDomains.has(domain);
        });
        const hiddenCount = outcome.results.length - visible.length;
        const lines = visible.map(
          (r) => `${r.rank}. ${r.title}\n   ${r.url}\n   ${r.snippet}${r.meta ? `\n   ${r.meta}` : ''}`,
        );
        emit('parse', { url: outcome.results[0]?.url, detail: outcome.query, result: `count=${visible.length}` });
        const degradeNote =
          outcome.degradations.length > 0
            ? `\n⚠️ 降级记录：${outcome.degradations
                .map((d) => `${SEARCH_ENGINE_LABELS[d.from]} → ${SEARCH_ENGINE_LABELS[d.to]}（${d.reason}）`)
                .join('；')}`
            : '';
        const hiddenNote = hiddenCount > 0 ? `\n\n已隐藏 ${hiddenCount} 条被屏蔽站点结果` : '';
        return textResult(
          `🔍 搜索完成\n引擎: ${SEARCH_ENGINE_LABELS[outcome.engine]}\n关键词: ${outcome.query}\n结果数: ${visible.length}${degradeNote}\n\n${lines.join('\n\n')}${hiddenNote}`,
        );
      },
    ),

    defineTool(
      'dogear__extension__save_article',
      '把网页文章保存到工作区文章库',
      '把已获取的文章内容保存到工作区文章库（写入 dogear/articles/ 下的 md 文件，frontmatter 承载元数据）。' +
        '典型场景：用 dogear__extension__readArticle 读取当前页面全文后调用本工具入库，闭环「读 → 存」。返回落盘路径，后续读取直接用 Read 读该路径。title/url/content 为必填。',
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
          if (!workspaceId || !workspacePath) {
            return isErrorResult('保存失败：当前会话未关联工作区，无法入库');
          }
          const { meta: article, relPath } = await saveArticleFromScript({
            workspaceId,
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
          emitAction(taskMeta, 'parse', {
            url: args.url,
            detail: args.title,
            result: `id=${article.id} wordCount=${article.wordCount}`,
          });
          return textResult(`已入库：${article.title}（${article.wordCount} 字）。文件：${relPath}`);
        } catch (err) {
          emitAction(taskMeta, 'parse', { url: args.url, result: 'error' });
          return isErrorResult(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        }
      },
    ),
  ];
}
