/**
 * 受控浏览器 MCP Server 工具
 *
 * 提供 dogear__browser__* 工具组：readArticle（声明式读文章）+ 原子探索工具
 * （navigate / observe_page / click / fill / read_text / wait_for / screenshot / close）。
 * readArticle 复用 browser-article-service（渲染等待 + 展开启发式 + 登录墙检测）；
 * 原子工具直接走 BrowserManager acquire，单步 30s 超时，错误一律 isError 不抛。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import type { Page } from 'patchright';
import {
  getBrowserManager,
  type BrowserLease,
  type BrowserTaskMeta,
} from '../../services/browser/browser-manager.js';
import {
  readArticleWithBrowser,
  type BrowserArticleAction,
  type BrowserArticleActionEvent,
} from '../../services/browser/browser-article-service.js';
import {
  searchWeb,
  type SearchAction,
  type SearchActionEvent,
} from '../../services/browser/browser-search-service.js';
import { loadSettings } from '../../services/settings-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef, type ToolResult } from '../pi/tool-adapter.js';

const ATOMIC_TIMEOUT_MS = 30_000;
const NAVIGATE_TIMEOUT_MS = 20_000;
const ELEMENT_TIMEOUT_MS = 5_000;
const OBSERVE_MAX_ITEMS = 120;
const OBSERVE_TEXT_CHARS = 80;
const READ_MAX_CHARS = 8_000;
const POLL_INTERVAL_MS = 400;
const REF_ATTR = 'data-dogear-ref';
const MAIN_CONTAINER_SELECTOR = 'article, main, [role="main"], #content, .content';

const SEARCH_ENGINE_LABELS: Record<string, string> = {
  google: 'Google',
  ddg: 'DuckDuckGo',
  bing: 'Bing',
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

// ref → 选择器映射：observe_page 打标重建，navigate/readArticle 导航后清空失效
const refMap = new Map<string, string>();

const refSelector = (ref: string) => `[${REF_ATTR}="${ref}"]`;

function clearRefs(): void {
  refMap.clear();
}

function unknownRefResult(ref: string | undefined): ToolResult {
  return isErrorResult(
    `ref "${ref}" 不存在或已失效（页面导航会清空元素引用）。请重新调用 dogear__browser__observe_page。`,
  );
}

interface ObserveElement {
  ref: string;
  tag: string;
  role: string;
  text: string;
  hint: string;
}

interface ObservePayload {
  total: number;
  regionCounts: { top: number; middle: number; bottom: number };
  elements: ObserveElement[];
}

const observeFn = new Function(`return ({ maxItems, textChars, textFilter, region }) => {
  document.querySelectorAll('[${REF_ATTR}]').forEach((el) => el.removeAttribute('${REF_ATTR}'));
  const selector =
    'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], ' +
    '[role="checkbox"], [role="radio"], [role="menuitem"], [role="combobox"], [role="option"], ' +
    '[role="textbox"], [contenteditable="true"]';
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const defaultRole = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit') return 'button';
      return 'textbox';
    }
    return 'generic';
  };
  const hintOf = (el) =>
    el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
  const textOf = (el) => {
    const raw = (el.tagName.toLowerCase() === 'input' ? el.value : el.innerText) || '';
    return raw.trim().replace(/\\s+/g, ' ').slice(0, textChars);
  };
  const vh = window.innerHeight;
  const regionOf = (rect) => {
    const cy = rect.top + rect.height / 2;
    if (cy < vh / 3) return 'top';
    if (cy > (2 * vh) / 3) return 'bottom';
    return 'middle';
  };
  const regionCounts = { top: 0, middle: 0, bottom: 0 };
  const matched = [];
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    const reg = regionOf(rect);
    regionCounts[reg]++;
    if (region && reg !== region) continue;
    const text = textOf(el);
    const hint = hintOf(el);
    if (textFilter) {
      const f = String(textFilter).toLowerCase();
      const hay = (text + ' ' + hint).toLowerCase();
      if (!hay.includes(f)) continue;
    }
    matched.push(el);
  }
  const shown = matched.slice(0, maxItems);
  const elements = shown.map((el, i) => {
    const ref = 'e' + (i + 1);
    el.setAttribute('${REF_ATTR}', ref);
    return {
      ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || defaultRole(el),
      text: textOf(el),
      hint: hintOf(el),
    };
  });
  return { total: matched.length, regionCounts, elements };
}`)() as (arg: {
  maxItems: number;
  textChars: number;
  textFilter?: string;
  region?: string;
}) => ObservePayload;

interface TextStats {
  container: number;
  body: number;
}

// 与 browser-article-service 的正文容器口径一致（article/main/[role=main]/#content/.content vs body）
const statsFn = new Function(`return () => {
  const trimmed = (el) => (el && el.innerText ? el.innerText.replace(/\\s+/g, '') : '').length;
  let container = 0;
  document.querySelectorAll('${MAIN_CONTAINER_SELECTOR}').forEach((el) => {
    container = Math.max(container, trimmed(el));
  });
  return { container, body: trimmed(document.body) };
}`)() as () => TextStats;

const mainTextOf = (stats: TextStats) => Math.max(stats.container, stats.body);

const extractTextFn = new Function(`return ({ maxChars }) => {
  const trimmed = (el) => (el && el.innerText ? el.innerText : '');
  let best = '';
  document.querySelectorAll('${MAIN_CONTAINER_SELECTOR}').forEach((el) => {
    if (trimmed(el).length > best.length) best = trimmed(el);
  });
  const text = best || trimmed(document.body);
  return { text: text.slice(0, maxChars), totalLength: text.length };
}`)() as (arg: { maxChars: number }) => { text: string; totalLength: number };

const bodyTextFn = new Function('return () => (document.body ? document.body.innerText : "")')() as () => string;

async function safeStats(page: Page): Promise<TextStats | null> {
  try {
    return await page.evaluate(statsFn);
  } catch {
    return null;
  }
}

async function runWithLease<T>(
  taskMeta: BrowserTaskMeta,
  fn: (page: Page) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  const timers: NodeJS.Timeout[] = [];
  const timeoutGuard = (): Promise<never> =>
    new Promise<never>((_, reject) => {
      timers.push(
        setTimeout(
          () => reject(new Error(`浏览器工具单步超时（${ATOMIC_TIMEOUT_MS / 1000}s 上限，含排队等待）`)),
          ATOMIC_TIMEOUT_MS,
        ),
      );
    });
  let lease: BrowserLease | null = null;
  try {
    lease = await Promise.race([getBrowserManager().acquire(taskMeta), timeoutGuard()]);
    const value = await Promise.race([fn(lease.page), timeoutGuard()]);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    for (const t of timers) clearTimeout(t);
    lease?.release();
  }
}

function formatObserve(payload: ObservePayload): string {
  if (payload.elements.length === 0) return '页面无匹配的可交互元素。';
  const lines = payload.elements.map((el) => {
    const text = el.text ? `"${el.text}"` : '（无文本）';
    const hint = el.hint ? ` hint="${el.hint}"` : '';
    return `[${el.ref}] ${el.tag}(${el.role}) ${text}${hint}`;
  });
  let header: string;
  if (payload.total <= payload.elements.length) {
    header = `页面可交互元素（共 ${payload.total} 个）：`;
  } else {
    header =
      `页面可交互元素（显示前 ${payload.elements.length} 个 / 共 ${payload.total} 个，超出显示上限 ${OBSERVE_MAX_ITEMS}）：\n` +
      `可传 region="top"|"middle"|"bottom"（各区域元素数：top ${payload.regionCounts.top} / middle ${payload.regionCounts.middle} / bottom ${payload.regionCounts.bottom}）或 text_filter 缩小范围重查。`;
  }
  return `${header}\n${lines.join('\n')}\n\nclick / fill / read_text 请使用上面的 ref 编号定位元素。`;
}

export function createBrowserToolDefs(opts?: { conversationId?: string }): ToolDef[] {
  const conversationId = opts?.conversationId;
  const meta = () => buildTaskMeta(conversationId);

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
        '- 返回 need_login 时：浏览器窗口已打开并停留在目标页，必须告知用户「浏览器窗口已打开，请在窗口中完成登录，登录完成后告诉我重试」；用户完成登录后重新调用本工具即可（登录态已持久化）。\n' +
        '- 结果附质量信号：正文可能不完整时会给出提示，可据此建议用户核对原文。',
      z.object({
        url: z.string().url().describe('文章页面完整 URL（含 http/https）'),
      }),
      async (args) => {
        const taskMeta = meta();
        const result = await readArticleWithBrowser(args.url, {
          taskMeta,
          onAction: forwardArticleAction,
        });
        clearRefs();
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
        '使用纪律：\n' +
        '- 需要发现内容（不知道具体 URL）时先用本工具搜索，搜到再用 dogear__browser__readArticle 阅读。\n' +
        '- 关键词用空格分隔核心词，避免整句提问，与普通搜索引擎用法一致。\n' +
        '- 本工具失败时可降级用 dogear__browser__navigate 打开搜索引擎结果页，再用 dogear__browser__observe_page / read_text 等原子工具手动探索。\n' +
        '- 返回降级提示且提到验证页时，告知用户可在受控浏览器窗口人工完成一次验证（profile 会记住）后重试。',
      z.object({
        query: z.string().trim().min(1).describe('搜索关键词，不能为空'),
        maxResults: z.number().int().min(1).max(15).optional().describe('返回结果条数上限（1-15），默认 8'),
      }),
      async (args) => {
        const taskMeta = meta();
        const settings = await loadSettings();
        const outcome = await searchWeb(args.query, {
          engine: settings.browserSearchEngine,
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
          (r) => `${r.rank}. ${r.title}\n   ${r.url}\n   ${r.snippet}`,
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
    // 工具 3: 导航
    // ========================================
    defineTool(
      'dogear__browser__navigate',
      '浏览器导航到 URL',
      '让受控浏览器导航到指定 URL，返回最终 URL、页面标题与正文字数摘要。仅用于 readArticle 失败后的手动探索流程；单纯读文章请用 dogear__browser__readArticle。',
      z.object({
        url: z.string().url().describe('目标页面完整 URL（含 http/https）'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: args.url });
        const r = await runWithLease(taskMeta, async (page) => {
          await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS });
          await page.waitForTimeout(800);
          const stats = await safeStats(page);
          return { url: page.url(), title: await page.title(), textLen: stats ? mainTextOf(stats) : 0 };
        });
        clearRefs();
        if (!r.ok) {
          emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: args.url, result: 'error', detail: r.message });
          return isErrorResult(`导航失败：${r.message}`);
        }
        emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: r.value.url, result: 'ok' });
        return textResult(
          `已导航到: ${r.value.url}\n标题: ${r.value.title}\n正文字数: ${r.value.textLen}\n` +
            `需要操作页面元素时，先调用 dogear__browser__observe_page 获取 ref 列表。`,
        );
      },
    ),

    // ========================================
    // 工具 4: 观察页面可交互元素
    // ========================================
    defineTool(
      'dogear__browser__observe_page',
      '列出页面可交互元素',
      '列出当前页面可见的可交互元素（链接/按钮/输入框等），每条含 ref 编号、标签、角色、文本（截断 80 字）与提示信息。' +
        'ref 用于 click / fill / read_text 定位。元素最多显示 120 个，超出时按提示传 region（视口上/中/下分块）或 text_filter 缩小范围重查。' +
        '页面导航后 ref 失效，需重新调用本工具。',
      z.object({
        region: z.enum(['top', 'middle', 'bottom']).optional().describe('按视口垂直位置过滤：top 上 1/3、middle 中 1/3、bottom 下 1/3'),
        text_filter: z.string().optional().describe('子串过滤：只返回文本或提示信息包含该子串的元素'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction({ source: 'observe_page', taskMeta, action: 'observe', detail: args.text_filter || args.region || '' });
        const r = await runWithLease(taskMeta, async (page) => {
          const payload = await page.evaluate(observeFn, {
            maxItems: OBSERVE_MAX_ITEMS,
            textChars: OBSERVE_TEXT_CHARS,
            textFilter: args.text_filter,
            region: args.region,
          });
          refMap.clear();
          for (const el of payload.elements) refMap.set(el.ref, refSelector(el.ref));
          return payload;
        });
        if (!r.ok) return isErrorResult(`观察页面失败：${r.message}`);
        return textResult(formatObserve(r.value));
      },
    ),

    // ========================================
    // 工具 5: 点击元素
    // ========================================
    defineTool(
      'dogear__browser__click',
      '点击页面元素',
      '点击 observe_page 返回的 ref 对应元素，点击后自动附带轻量验证（URL 变化 / 元素消失 / 正文字数变化）。需要用户确认后执行。',
      z.object({
        ref: z.string().describe('observe_page 返回的元素 ref（如 "e3"）'),
      }),
      async (args) => {
        const taskMeta = meta();
        const selector = refMap.get(args.ref);
        if (!selector) return unknownRefResult(args.ref);
        const r = await runWithLease(taskMeta, async (page) => {
          const urlBefore = page.url();
          const before = await safeStats(page);
          await page.click(selector, { timeout: ELEMENT_TIMEOUT_MS });
          await page.waitForTimeout(POLL_INTERVAL_MS);
          const after = await safeStats(page);
          let elementGone = false;
          try {
            elementGone = (await page.$(selector)) === null;
          } catch {
            elementGone = true;
          }
          return {
            urlBefore,
            urlAfter: page.url(),
            elementGone,
            textBefore: before ? mainTextOf(before) : 0,
            textAfter: after ? mainTextOf(after) : 0,
          };
        });
        if (!r.ok) {
          emitAction({ source: 'click', taskMeta, action: 'click', detail: args.ref, result: 'error' });
          return isErrorResult(`点击失败：${r.message}`);
        }
        emitAction({ source: 'click', taskMeta, action: 'click', url: r.value.urlAfter, detail: args.ref, result: 'clicked' });
        const changes: string[] = [];
        if (r.value.urlAfter !== r.value.urlBefore) {
          changes.push(
            `已触发导航：${r.value.urlBefore} → ${r.value.urlAfter}（旧元素引用已失效，操作新页面请重新 observe_page）`,
          );
          clearRefs();
        }
        if (r.value.elementGone) changes.push('目标元素已从页面消失');
        if (r.value.textAfter !== r.value.textBefore) changes.push(`正文字数 ${r.value.textBefore} → ${r.value.textAfter}`);
        if (changes.length === 0) changes.push('页面无明显变化（可能为无效果点击）');
        return textResult(`已点击 ${args.ref}。验证：${changes.join('；')}`);
      },
    ),

    // ========================================
    // 工具 6: 填写输入框
    // ========================================
    defineTool(
      'dogear__browser__fill',
      '填写页面输入框',
      '向 observe_page 返回的 ref 对应输入框填写文本（会清空原内容），填写后自动验证值是否生效。需要用户确认后执行。',
      z.object({
        ref: z.string().describe('observe_page 返回的输入框 ref（如 "e2"）'),
        value: z.string().describe('要填写的文本'),
      }),
      async (args) => {
        const taskMeta = meta();
        const selector = refMap.get(args.ref);
        if (!selector) return unknownRefResult(args.ref);
        const r = await runWithLease(taskMeta, async (page) => {
          await page.fill(selector, args.value, { timeout: ELEMENT_TIMEOUT_MS });
          const applied = await page
            .$eval(selector, (el, expected) => (el as unknown as { value?: string }).value === expected, args.value)
            .catch(() => false);
          return { url: page.url(), applied };
        });
        if (!r.ok) {
          emitAction({ source: 'fill', taskMeta, action: 'fill', detail: args.ref, result: 'error' });
          return isErrorResult(`填写失败：${r.message}`);
        }
        emitAction({
          source: 'fill',
          taskMeta,
          action: 'fill',
          url: r.value.url,
          detail: args.ref,
          result: r.value.applied ? 'filled' : 'value_mismatch',
        });
        return textResult(
          `已向 ${args.ref} 填写文本。验证：${r.value.applied ? '值已生效' : '元素当前值与输入不一致（页面可能改写了内容）'}。` +
            `如需提交，请 observe_page 后 click 对应提交按钮。`,
        );
      },
    ),

    // ========================================
    // 工具 7: 读取文本
    // ========================================
    defineTool(
      'dogear__browser__read_text',
      '读取页面元素或正文文本',
      '读取指定 ref 元素的纯文本；不传 ref 则读取正文容器（article/main 等中字数最大者）。文本超过 8000 字符时截断并提示，可用 observe_page 定位子元素分次读取。',
      z.object({
        ref: z.string().optional().describe('要读取的元素 ref；不传则读正文容器'),
      }),
      async (args) => {
        const taskMeta = meta();
        const selector = args.ref ? refMap.get(args.ref) : undefined;
        if (args.ref && !selector) return unknownRefResult(args.ref);
        emitAction({ source: 'read_text', taskMeta, action: 'read_text', detail: args.ref || 'main' });
        const r = await runWithLease(taskMeta, async (page) => {
          if (selector) {
            const el = await page.$(selector);
            if (!el) {
              return { ok: false as const, message: `ref "${args.ref}" 对应元素已不在页面上，请重新 observe_page` };
            }
            const text = await el.innerText();
            return { ok: true as const, text: text.slice(0, READ_MAX_CHARS), totalLength: text.length };
          }
          const payload = await page.evaluate(extractTextFn, { maxChars: READ_MAX_CHARS });
          return { ok: true as const, text: payload.text, totalLength: payload.totalLength };
        });
        if (!r.ok) return isErrorResult(`读取失败：${r.message}`);
        if (!r.value.ok) return isErrorResult(r.value.message);
        const truncated =
          r.value.totalLength > READ_MAX_CHARS
            ? `\n\n（已截断：原文共 ${r.value.totalLength} 字符，显示前 ${READ_MAX_CHARS}；可用 observe_page 定位子元素分次读取）`
            : '';
        return textResult(`${r.value.text}${truncated}`);
      },
    ),

    // ========================================
    // 工具 8: 等待条件
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
        const r = await runWithLease(taskMeta, async (page) => {
          const deadline = Date.now() + args.timeout * 1000;
          while (Date.now() < deadline) {
            const url = page.url();
            if (args.url_contains && url.includes(args.url_contains)) return { matched: true, url };
            if (args.text) {
              const bodyText = await page.evaluate(bodyTextFn).catch(() => '');
              if (bodyText.includes(args.text)) return { matched: true, url };
            }
            await page.waitForTimeout(POLL_INTERVAL_MS);
          }
          return { matched: false, url: page.url() };
        });
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
    // 工具 9: 截图
    // ========================================
    defineTool(
      'dogear__browser__screenshot',
      '截取当前页面截图',
      '对受控浏览器当前页面截取视口截图，保存为临时 PNG 文件并返回路径。查看图片：把返回的路径传给 Read 工具即可（Read 原生支持图片附件）。',
      z.object({}),
      async () => {
        const taskMeta = meta();
        emitAction({ source: 'screenshot', taskMeta, action: 'screenshot' });
        const r = await runWithLease(taskMeta, async (page) => {
          const buffer = await page.screenshot({ type: 'png' });
          const file = path.join(os.tmpdir(), `dogear-browser-${Date.now()}.png`);
          await fs.promises.writeFile(file, buffer);
          return { file, url: page.url() };
        });
        if (!r.ok) {
          emitAction({ source: 'screenshot', taskMeta, action: 'screenshot', result: 'error' });
          return isErrorResult(`截图失败：${r.message}`);
        }
        emitAction({ source: 'screenshot', taskMeta, action: 'screenshot', url: r.value.url, result: r.value.file });
        return textResult(`截图已保存: ${r.value.file}\n用 Read 工具读取该路径即可查看图片。`);
      },
    ),

    // ========================================
    // 工具 10: 结束浏览器任务
    // ========================================
    defineTool(
      'dogear__browser__close',
      '结束浏览器任务（通常无需调用）',
      '声明浏览器探索任务结束，清空元素引用。浏览器实例本身由空闲策略自动关闭（默认 3 分钟），一般无需显式调用本工具。',
      z.object({}),
      async () => {
        clearRefs();
        emitAction({ source: 'close', taskMeta: meta(), action: 'close', result: 'ok' });
        return textResult(
          '已清空页面元素引用。浏览器实例会在空闲约 3 分钟后自动关闭，无需其他操作；再次需要时直接调用工具即可自动启动。',
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

