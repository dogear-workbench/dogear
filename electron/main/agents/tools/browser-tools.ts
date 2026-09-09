/**
 * 内嵌浏览器 MCP Server 工具
 *
 * 提供 dogear__browser__* 工具组：readArticle/search（声明式入口，服务内部仍用 Patchright，Step 4 迁移）+
 * 原子探索工具（observe_page / find / read_text / navigate / wait_for / screenshot，全部走内嵌宿主）。
 * ref = backendNodeId@generation；导航/SPA 路由/CDP 重连使 generation 递增，失效返回明确恢复引导。
 * click/fill 属操作原语（含风控 gate），Step 3 切内嵌，当前返回明确过渡指引。
 * 错误一律 isError 不抛。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import type { BrowserTaskMeta } from '../../services/browser/browser-manager.js';
import {
  findInTab,
  observeTab,
  readTabText,
  READ_MAX_CHARS,
} from '../../services/browser/embedded/ax-observe.js';
import {
  readArticleWithBrowser,
  type BrowserArticleAction,
  type BrowserArticleActionEvent,
} from '../../services/browser/browser-article-service.js';
import { controlledBrowserBlock } from '../../services/browser/site-policy.js';
import {
  searchWeb,
  type SearchAction,
  type SearchActionEvent,
} from '../../services/browser/browser-search-service.js';
import { loadSettings } from '../../services/settings-service.js';
import { saveArticleFromScript } from '../../services/article-service.js';
import { getEmbeddedBrowserManager } from '../../services/browser/embedded/embedded-browser-manager.js';
import { navigateTab } from '../../services/browser/embedded/navigate.js';
import { waitForTabCondition } from '../../services/browser/embedded/wait-for.js';
import { type ObserveElement, type ObservePayload } from '../../services/browser/embedded/ax-tree.js';
import type { EmbeddedTabRecord } from '../../services/browser/embedded/types.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef, type ToolResult } from '../pi/tool-adapter.js';

const SCREENSHOT_TIMEOUT_MS = 10_000;

function withTimeout<T>(label: string, timeoutMs: number, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时，请稍后重试`)), timeoutMs);
    Promise.resolve()
      .then(run)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

const CLICK_FILL_MIGRATION_NOTE =
  '点击/填写操作正在切换到内嵌宿主（本版本暂不可用）。请改用：\n' +
  '- 需要跳转时：从 observe_page 结果取链接 href 调 dogear__browser__navigate 直达；\n' +
  '- 需要在用户浏览器操作时：改用扩展通道 dogear__extension__click / fill。';

const SEARCH_ENGINE_LABELS: Record<string, string> = {
  google: 'Google',
  ddg: 'DuckDuckGo',
  bing: 'Bing',
  reddit: 'Reddit',
  zhihu: '知乎',
};

export type BrowserToolsAction =
  | BrowserArticleAction
  | SearchAction
  | 'fill'
  | 'read_text'
  | 'wait_for'
  | 'screenshot'
  | 'close';

export interface BrowserToolsActionEvent {
  source: string;
  taskMeta: BrowserTaskMeta;
  action: BrowserToolsAction;
  url?: string;
  detail?: string;
  result?: string;
}

type ActionListener = (event: BrowserToolsActionEvent) => void;

let actionListener: ActionListener | null = null;

/** step5 动作流接入点：注册后所有浏览器工具的动作事件转发给监听者 */
export function setBrowserToolsActionListener(listener: ActionListener | null): void {
  actionListener = listener;
}

function emitAction(event: BrowserToolsActionEvent): void {
  if (actionListener) actionListener(event);
}

function forwardArticleAction(event: BrowserArticleActionEvent): void {
  emitAction({
    source: 'readArticle',
    taskMeta: event.taskMeta,
    action: event.action,
    url: event.url,
    detail: event.detail,
    result: event.result,
  });
}

function forwardSearchAction(event: SearchActionEvent): void {
  emitAction({
    source: 'search',
    taskMeta: event.taskMeta,
    action: event.action,
    url: event.url,
    detail: event.detail,
    result: event.result,
  });
}

function buildTaskMeta(conversationId: string | undefined): BrowserTaskMeta {
  return conversationId ? { kind: 'agent', conversationId } : { kind: 'agent' };
}

function isErrorResult(message: string): ToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

function formatObserveElement(el: ObserveElement): string {
  const text = el.text ? `"${el.text}"` : '（无文本）';
  const hint = el.hint ? ` hint="${el.hint}"` : '';
  const href = el.href ? ` href="${el.href}"` : '';
  const level = el.level !== undefined ? `(level=${el.level})` : '';
  const editable = el.editable ? ' [可输入]' : '';
  return `[${el.ref}] ${el.role}${level} ${text}${hint}${href}${editable}`;
}

function formatEmbeddedObserve(payload: ObservePayload): string {
  const sections: string[] = [
    `页面观察（AX 语义树）\nURL: ${payload.url}\n标题: ${payload.title}\n状态: ${payload.pageState}（generation ${payload.generation}）`,
  ];
  if (payload.elements.length === 0) {
    sections.push('可交互元素：无匹配（可传 text_filter 缩小范围重查，或用 find 按 role+name 查找）。');
  } else {
    let header = `可交互元素（共 ${payload.totalInteractive} 个）：`;
    if (payload.truncated) {
      header =
        `可交互元素（显示前 ${payload.shownInteractive} 个 / 共 ${payload.totalInteractive} 个，超出安全上限）：\n` +
        `可传 region="top"|"middle"|"bottom"（各区域元素数：top ${payload.regionCounts.top} / middle ${payload.regionCounts.middle} / bottom ${payload.regionCounts.bottom}）或 text_filter 缩小范围重查；也可用 find 按 role+name 精确查找。`;
    }
    sections.push(`${header}\n${payload.elements.map(formatObserveElement).join('\n')}`);
  }
  if (payload.headings.length > 0) {
    sections.push(`标题结构（页面骨架）：\n${payload.headings.map(formatObserveElement).join('\n')}`);
  }
  if (payload.roleSummary.length > 0) {
    const summary = payload.roleSummary
      .map((item) => `${item.role}×${item.count}（共 ${item.totalChars} 字${item.sample ? `，示例"${item.sample}"` : ''}）`)
      .join('；');
    sections.push(`其余语义节点摘要（按文本量排序）：${summary}`);
  }
  sections.push(
    'ref 格式为 节点id@generation，可直接用于 read_text/find；页面导航、SPA 路由变化或提示 ref 失效时，请重新 observe_page。',
  );
  return sections.join('\n\n');
}

export function createBrowserToolDefs(opts?: {
  conversationId?: string;
  workspacePath?: string;
  workspaceId?: string;
}): ToolDef[] {
  const conversationId = opts?.conversationId;
  const workspacePath = opts?.workspacePath;
  const embeddedWorkspaceId = opts?.workspaceId;
  const embeddedHolderId = conversationId ?? 'browser-tools';
  const meta = () => buildTaskMeta(conversationId);

  const NO_AGENT_TAB_MESSAGE =
    '内嵌浏览器暂无活动标签页，请先调用 dogear__browser__navigate 打开页面后再观察。';

  async function withAgentTab<T>(
    fn: (tab: EmbeddedTabRecord) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
    if (!embeddedWorkspaceId) {
      return { ok: false, message: '当前会话未关联工作区，内嵌浏览器观察通道不可用' };
    }
    try {
      const manager = getEmbeddedBrowserManager();
      const tabId = manager.getAgentTabId(embeddedWorkspaceId);
      const record = tabId ? manager.getTabRecord(tabId) : null;
      if (!tabId || !record) return { ok: false, message: NO_AGENT_TAB_MESSAGE };
      manager.retain(tabId, embeddedHolderId);
      return { ok: true, value: await fn(record) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  return [
    // ========================================
    // 工具 1: 读取文章（声明式，首选入口）
    // ========================================
    defineTool(
      'dogear__browser__readArticle',
      '用浏览器读取网页文章（首选）',
      '通过受控浏览器读取网页文章，返回渲染后的 Markdown 正文与元数据。内置渲染等待、展开全文按钮点击与登录墙检测。\n' +
        '使用纪律：\n' +
        '- 需要读取网页文章内容时优先调用本工具，不要直接从原子工具开始。\n' +
        '- 仅当本工具失败（timeout / parse_empty）或需要登录后才能交互探索时，才降级使用 navigate → observe_page → click / read_text 等原子工具。\n' +
        '- 小红书等登录态站点禁止本通道（调用会被直接拒绝），请改用 dogear__extension__* 扩展通道在用户真实浏览器上操作。\n' +
        '- 返回 need_login 时：浏览器窗口已打开并停留在目标页，必须告知用户「浏览器窗口已打开，请在窗口中完成登录，登录完成后告诉我重试」；用户完成登录后重新调用本工具即可（登录态已持久化）。\n' +
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
            return isErrorResult(
              `读取失败：页面需要登录（need_login）。\n` +
                `浏览器窗口已打开并置前，停留在目标页。\n` +
                `请立即告知用户：浏览器窗口已打开，请在窗口中完成登录；登录完成后让你重试时，重新调用本工具即可。`,
            );
          }
          return isErrorResult(
            `读取失败（${result.errorClass}）：${result.message}\n` +
              `可降级用 dogear__browser__navigate 打开页面，再用 observe_page / read_text / click 等原子工具手动探索。`,
          );
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
      '搜索网页并返回结果列表',
      '通过受控浏览器在搜索引擎搜索关键词，返回结构化结果列表（标题 / URL / 摘要）。引擎链 Google → DuckDuckGo → Bing 自动降级，引擎与代理在设置页「基础设置 → 受控浏览器」配置。\n' +
        '传 site="reddit" 或 site="zhihu" 时走站内搜索：reddit 用 old.reddit（结果带 score/评论数/subreddit），zhihu 用知乎搜索页（结果带作者/赞同数）；站内失败自动降级为「关键词 site:域名」通用搜索（丢互动量但保可用，降级原因见返回）。\n' +
        '使用纪律：\n' +
        '- 需要发现内容（不知道具体 URL）时先用本工具搜索，搜到再用 dogear__browser__readArticle 阅读。\n' +
        '- 需要站内互动量排序（高赞/高票）或某个站的垂直内容时传 site；不传 site 走通用引擎，行为不变。\n' +
        '- 关键词用空格分隔核心词，避免整句提问，与普通搜索引擎用法一致。\n' +
        '- 本工具失败时可降级用 dogear__browser__navigate 打开搜索引擎结果页，再用 dogear__browser__observe_page / read_text 等原子工具手动探索。\n' +
        '- 站内搜索对登录态敏感：知乎未登录可能返回空结果，Reddit 未登录会跳登录页；降级原因提到登录或空结果时，提示用户在受控浏览器窗口人工登录对应站点一次（profile 会记住）后重试。\n' +
        '- 返回降级提示且提到验证页时，告知用户可在受控浏览器窗口人工完成一次验证（profile 会记住）后重试。',
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
        });
        if (!outcome.ok) {
          emitAction({
            source: 'search',
            taskMeta,
            action: 'parse',
            detail: outcome.message,
            result: outcome.errorClass,
          });
          const fallbackHint =
            outcome.errorClass === 'empty_query' || outcome.errorClass === 'parse_empty'
              ? ''
              : '\n可降级用 dogear__browser__navigate 打开搜索引擎结果页，再用 dogear__browser__observe_page / read_text 等原子工具手动探索。';
          return isErrorResult(`搜索失败（${outcome.errorClass}）：${outcome.message}${fallbackHint}`);
        }
        const lines = outcome.results.map(
          (r) => `${r.rank}. ${r.title}\n   ${r.url}\n   ${r.snippet}${r.meta ? `\n   ${r.meta}` : ''}`,
        );
        const degradeNote =
          outcome.degradations.length > 0
            ? `\n⚠️ 降级记录：${outcome.degradations
                .map((d) => `${SEARCH_ENGINE_LABELS[d.from]} → ${SEARCH_ENGINE_LABELS[d.to]}（${d.reason}）`)
                .join('；')}\n如涉及验证页，可在受控浏览器窗口人工完成一次验证，profile 会记住。`
            : '';
        return textResult(
          `🔍 搜索完成\n引擎: ${SEARCH_ENGINE_LABELS[outcome.engine]}\n关键词: ${outcome.query}\n结果数: ${outcome.results.length}${degradeNote}\n\n${lines.join('\n\n')}`,
        );
      },
    ),

    // ========================================
    // 工具 3: 导航（内嵌宿主）
    // ========================================
    defineTool(
      'dogear__browser__navigate',
      '浏览器导航到 URL',
      '让内嵌浏览器导航到指定 URL，等待加载就绪后返回最终 URL、标题、正文字数与页面状态。仅用于 readArticle 失败后的手动探索流程；单纯读文章请用 dogear__browser__readArticle。小红书等登录态站点禁止本通道，请用 dogear__extension__* 扩展通道。',
      z.object({
        url: z.string().url().describe('目标页面完整 URL（含 http/https）'),
      }),
      async (args) => {
        const taskMeta = meta();
        const blocked = controlledBrowserBlock(args.url);
        if (blocked) {
          emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: args.url, detail: blocked, result: 'site_forbidden' });
          return isErrorResult(blocked);
        }
        if (!embeddedWorkspaceId) {
          return isErrorResult('当前会话未关联工作区，内嵌浏览器通道不可用');
        }
        emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: args.url });
        try {
          const { snapshot, record } = await navigateTab(
            getEmbeddedBrowserManager(),
            embeddedWorkspaceId,
            args.url,
            embeddedHolderId,
          );
          const stats = await readTabText(record).catch(() => ({ text: '', totalLength: 0 }));
          emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: snapshot.url, result: 'ok' });
          return textResult(
            `已导航到: ${snapshot.url}\n标题: ${snapshot.title}\n正文字数: ${stats.totalLength}\n状态: ${snapshot.state}（generation ${snapshot.generation}）\n` +
              `需要操作页面元素时，先调用 dogear__browser__observe_page 获取 ref 列表。`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: args.url, result: 'error', detail: message });
          return isErrorResult(`导航失败：${message}`);
        }
      },
    ),

    // ========================================
    // 工具 4: 观察页面（内嵌 CDP AX 语义树）
    // ========================================
    defineTool(
      'dogear__browser__observe_page',
      '列出页面可交互元素',
      '列出当前页面的可交互元素（CDP 无障碍语义树观察），每条含 ref（格式 节点id@generation）、角色、文本（长文本截断）与提示信息，链接带 href。' +
        '可交互元素全列不硬截断；超长页面附标题结构与其余节点的 role 分级摘要。' +
        '可传 region（视口上/中/下分块）或 text_filter 缩小范围重查；超长列表也可用 dogear__browser__find 按 role+name 精确查找。' +
        '页面导航或 SPA 路由变化后 ref 失效，需重新调用本工具。',
      z.object({
        region: z.enum(['top', 'middle', 'bottom']).optional().describe('按视口垂直位置过滤：top 上 1/3、middle 中 1/3、bottom 下 1/3'),
        text_filter: z.string().optional().describe('子串过滤：只返回文本或提示信息包含该子串的元素'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction({ source: 'observe_page', taskMeta, action: 'observe', detail: args.text_filter || args.region || '' });
        const r = await withAgentTab((tab) => observeTab(tab, { region: args.region, textFilter: args.text_filter }));
        if (!r.ok) return isErrorResult(`观察页面失败：${r.message}`);
        return textResult(formatEmbeddedObserve(r.value));
      },
    ),

    // ========================================
    // 工具 5: 语义查找（AX 树 role+name）
    // ========================================
    defineTool(
      'dogear__browser__find',
      '按 role+name 在页面中语义查找元素',
      '在当前页面的无障碍语义树中按 role（如 link/button/textbox/heading/combobox）与 name（元素文本）重新查找，' +
        '默认子串匹配，exact=true 时精确匹配；不依赖上次 observe_page 的结果，可发现未出现在其输出中的元素。' +
        '至少提供 role 或 name 之一。返回带可直接使用的 ref（格式 节点id@generation）。页面导航或路由变化后需重新查找。',
      z.object({
        role: z.string().optional().describe('AX 角色名，如 link、button、textbox、heading、combobox'),
        name: z.string().optional().describe('元素名称（可见文本）子串'),
        exact: z.boolean().optional().describe('name 是否精确匹配（默认子串包含）'),
        max_results: z.number().int().min(1).max(50).optional().describe('返回上限，默认 20，最大 50'),
      }),
      async (args) => {
        const taskMeta = meta();
        const detail = [args.role, args.name].filter(Boolean).join(' ');
        emitAction({ source: 'find', taskMeta, action: 'observe', detail });
        const r = await withAgentTab((tab) =>
          findInTab(tab, { role: args.role, name: args.name, exact: args.exact, maxResults: args.max_results }),
        );
        if (!r.ok) return isErrorResult(`查找失败：${r.message}`);
        if (r.value.elements.length === 0) {
          return textResult(
            `未找到匹配元素（role=${args.role ?? '任意'}，name="${args.name ?? '任意'}"${args.exact ? '，精确匹配' : ''}）。\n` +
              `当前页面: ${r.value.url}（${r.value.pageState}）。可放宽匹配条件、换近义词，或用 observe_page 查看页面全貌。`,
          );
        }
        return textResult(
          `找到 ${r.value.elements.length} 个匹配元素（页面 ${r.value.url}，${r.value.pageState}，generation ${r.value.generation}）：\n` +
            `${r.value.elements.map(formatObserveElement).join('\n')}\n\nref 可直接用于 read_text/find；页面导航或路由变化后需重新查找。`,
        );
      },
    ),

    // ========================================
    // 工具 6: 点击元素（Step 3 切内嵌操作原语）
    // ========================================
    defineTool(
      'dogear__browser__click',
      '点击页面元素',
      '点击 observe_page 返回的 ref 对应元素。需要用户确认后执行。',
      z.object({
        ref: z.string().describe('observe_page 返回的元素 ref（如 "e3"）'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction({ source: 'click', taskMeta, action: 'click', detail: args.ref, result: 'migration_blocked' });
        return isErrorResult(`${CLICK_FILL_MIGRATION_NOTE}`);
      },
    ),

    // ========================================
    // 工具 7: 填写输入框（Step 3 切内嵌操作原语）
    // ========================================
    defineTool(
      'dogear__browser__fill',
      '填写页面输入框',
      '向 observe_page 返回的 ref 对应输入框填写文本（会清空原内容）。需要用户确认后执行。',
      z.object({
        ref: z.string().describe('observe_page 返回的输入框 ref（如 "e2"）'),
        value: z.string().describe('要填写的文本'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction({ source: 'fill', taskMeta, action: 'fill', detail: args.ref, result: 'migration_blocked' });
        return isErrorResult(`${CLICK_FILL_MIGRATION_NOTE}`);
      },
    ),

    // ========================================
    // 工具 8: 读取文本（内嵌 CDP）
    // ========================================
    defineTool(
      'dogear__browser__read_text',
      '读取页面元素或正文文本',
      '读取指定 ref 元素的纯文本（ref 来自 observe_page/find，格式 节点id@generation）；不传 ref 则读取正文容器（article/main 等中字数最大者）。' +
        '文本超过 8000 字符时截断并提示，可用 observe_page/find 重新定位后分次读取。',
      z.object({
        ref: z.string().optional().describe('要读取的元素 ref（如 "123@5"）；不传则读正文容器'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction({ source: 'read_text', taskMeta, action: 'read_text', detail: args.ref || 'main' });
        const r = await withAgentTab((tab) => readTabText(tab, args.ref));
        if (!r.ok) return isErrorResult(`读取失败：${r.message}`);
        const truncated =
          r.value.totalLength > READ_MAX_CHARS
            ? `\n\n（已截断：原文共 ${r.value.totalLength} 字符，显示前 ${READ_MAX_CHARS}；可用 observe_page/find 重新定位子元素后分次读取）`
            : '';
        return textResult(`${r.value.text}${truncated}`);
      },
    ),

    // ========================================
    // 工具 9: 等待条件（内嵌宿主）
    // ========================================
    defineTool(
      'dogear__browser__wait_for',
      '等待页面条件出现',
      '在超时时间内轮询等待页面满足条件：页面文本包含 text，或 URL 包含 url_contains（至少提供一个）。适用于点击后的跳转/异步加载等待。',
      z.object({
        text: z.string().optional().describe('等待页面文本包含该子串'),
        url_contains: z.string().optional().describe('等待 URL 包含该子串'),
        timeout: z.number().min(1).max(30).default(10).describe('超时秒数，默认 10，最大 30'),
      }),
      async (args) => {
        if (!args.text && !args.url_contains) {
          return isErrorResult('text 与 url_contains 至少提供一个');
        }
        const taskMeta = meta();
        emitAction({ source: 'wait_for', taskMeta, action: 'wait', detail: args.text ?? args.url_contains });
        const r = await withAgentTab((tab) => waitForTabCondition(tab, { text: args.text, urlContains: args.url_contains, timeoutSec: args.timeout }));
        if (!r.ok) return isErrorResult(`等待失败：${r.message}`);
        if (!r.value.matched) {
          const conditions = [
            args.url_contains ? `URL 未包含 "${args.url_contains}"` : '',
            args.text ? `页面文本未包含 "${args.text}"` : '',
          ]
            .filter(Boolean)
            .join('，');
          return isErrorResult(`等待超时（${args.timeout}s）：${conditions}。当前 URL: ${r.value.url}`);
        }
        return textResult(`条件已满足。当前 URL: ${r.value.url}`);
      },
    ),

    // ========================================
    // 工具 10: 截图（内嵌宿主）
    // ========================================
    defineTool(
      'dogear__browser__screenshot',
      '截取当前页面截图',
      '对内嵌浏览器当前页面截取视口截图，保存为临时 PNG 文件并返回路径。查看图片：把返回的路径传给 Read 工具即可（Read 原生支持图片附件）。',
      z.object({}),
      async () => {
        const taskMeta = meta();
        emitAction({ source: 'screenshot', taskMeta, action: 'screenshot' });
        const r = await withAgentTab(async (tab) => {
          const image = await withTimeout(`截图（${SCREENSHOT_TIMEOUT_MS / 1000}s 上限）`, SCREENSHOT_TIMEOUT_MS, () => tab.view.webContents.capturePage());
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

    // ========================================
    // 工具 10: 文章入库
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
    // 工具 11: 结束浏览器任务
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
  ];
}

registerToolGroup({
  server: 'dogear-browser',
  label: '浏览器',
  create: createBrowserToolDefs,
  placeholder: [{}],
});

