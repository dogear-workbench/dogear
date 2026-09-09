/**
 * 浏览器工具层共享资产
 *
 * 动作流事件机制、通用结果包装、内嵌 agent 标签访问器与观察结果格式化，
 * 供 browser-tools.ts（声明式入口）与 browser-atom-tools.ts（内嵌原子工具）共用。
 */

import type { BrowserTaskMeta } from '../../services/browser/browser-manager.js';
import {
  findInTab,
  observeTab,
  type ObserveOptions,
} from '../../services/browser/embedded/ax-observe.js';
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
import { getEmbeddedBrowserManager } from '../../services/browser/embedded/embedded-browser-manager.js';
import { type ObserveElement, type ObservePayload } from '../../services/browser/embedded/ax-tree.js';
import type { EmbeddedTabRecord } from '../../services/browser/embedded/types.js';
import { defineTool, type ToolResult } from '../pi/tool-adapter.js';

export const SEARCH_ENGINE_LABELS: Record<string, string> = {
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
  | 'scroll'
  | 'read_state'
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

export function emitAction(event: BrowserToolsActionEvent): void {
  if (actionListener) actionListener(event);
}

export function forwardArticleAction(event: BrowserArticleActionEvent): void {
  emitAction({
    source: 'readArticle',
    taskMeta: event.taskMeta,
    action: event.action,
    url: event.url,
    detail: event.detail,
    result: event.result,
  });
}

export function forwardSearchAction(event: SearchActionEvent): void {
  emitAction({
    source: 'search',
    taskMeta: event.taskMeta,
    action: event.action,
    url: event.url,
    detail: event.detail,
    result: event.result,
  });
}

export function buildTaskMeta(conversationId: string | undefined): BrowserTaskMeta {
  return conversationId ? { kind: 'agent', conversationId } : { kind: 'agent' };
}

export function isErrorResult(message: string): ToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

export function withTimeout<T>(label: string, timeoutMs: number, run: () => Promise<T>): Promise<T> {
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

export const NO_AGENT_TAB_MESSAGE =
  '内嵌浏览器暂无活动标签页，请先调用 dogear__browser__navigate 打开页面后再观察。';

/** 内嵌 agent 标签访问器：无工作区/无标签时返回统一可恢复错误文案 */
export function createAgentTabRunner(embeddedWorkspaceId: string | undefined, holderId: string) {
  return async function withAgentTab<T>(
    fn: (tab: EmbeddedTabRecord) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; message: string; error: unknown }> {
    if (!embeddedWorkspaceId) {
      return { ok: false, message: '当前会话未关联工作区，内嵌浏览器观察通道不可用', error: null };
    }
    try {
      const manager = getEmbeddedBrowserManager();
      const tabId = manager.getAgentTabId(embeddedWorkspaceId);
      const record = tabId ? manager.getTabRecord(tabId) : null;
      if (!tabId || !record) return { ok: false, message: NO_AGENT_TAB_MESSAGE, error: null };
      manager.retain(tabId, holderId);
      return { ok: true, value: await fn(record) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), error: err };
    }
  };
}

export function formatObserveElement(el: ObserveElement): string {
  const text = el.text ? `"${el.text}"` : '（无文本）';
  const hint = el.hint ? ` hint="${el.hint}"` : '';
  const href = el.href ? ` href="${el.href}"` : '';
  const level = el.level !== undefined ? `(level=${el.level})` : '';
  const editable = el.editable ? ' [可输入]' : '';
  return `[${el.ref}] ${el.role}${level} ${text}${hint}${href}${editable}`;
}

export function formatEmbeddedObserve(payload: ObservePayload): string {
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
    'ref 格式为 节点id@generation，可直接用于 click/fill/scroll/read_text/find；页面导航、SPA 路由变化或提示 ref 失效时，请重新 observe_page。',
  );
  return sections.join('\n\n');
}
