/**
 * 扩展通道 tab 管理工具：open_tab / close_tab / list_tabs
 *
 * 从 extension-tools 拆出。焦点 tab 模型：open_tab 开新页即成操作焦点（无 select_tab）；
 * close_tab/list_tabs 无页面交互不过站点策略（对齐 site_knowledge 先例）。
 * isErrorResult / textResult / emitAction 等经 deps 注入，不在此复制。
 */

import { z } from 'zod';
import { getExtensionStatus, validateNavigateTarget } from '../../services/browser/browser-gateway.js';
import { mainLogger } from '../../agents/logger.js';
import type { BrowserActionType } from '../../services/browser/browser-action-stream.js';
import { NO_FOCUS_TAB_ID } from '../../services/browser/gateway-tab-state.js';
import {
  MAX_TABS_PER_SESSION,
  consumeSearch,
  isPaymentBlocked,
  navigateGate,
  paymentBlockedMessage,
  tabLimitReachedMessage,
} from '../../services/browser/site-policy.js';
import {
  EMPTY_GROUP_MESSAGE,
  ERROR_MESSAGES,
  buildTaskMeta,
  commandErrorMessage,
  runCommand,
  type ActionExtra,
} from './extension-command-shared.js';
import { siteKnowledgePointer, sitePolicyPointer } from './extension-site-tools.js';
import { pageStateSuffix } from './extension-observe-format.js';
import { defineTool, type ToolDef, type ToolResult } from '../pi/tool-adapter.js';

export interface ExtensionTabToolDeps {
  conversationId?: string;
  acquireGate: (action: BrowserActionType | null, detail: string, url?: string) => ToolResult | null;
  isErrorResult: (message: string) => ToolResult;
  textResult: (text: string) => ToolResult;
  emitAction: (action: BrowserActionType, extra?: ActionExtra) => void;
  scopeNote: string;
}

interface OpenTabPayload {
  tabId?: number;
  url?: string;
  title?: string;
  pageState?: string;
  grouped?: boolean;
}

interface CloseTabPayload {
  closedTabId?: number;
  focusedTabId: number | null;
}

interface TabListItem {
  tabId: number;
  url: string;
  title: string;
  focused: boolean;
}

function parseOpenTabPayload(data: unknown): OpenTabPayload {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    tabId: typeof d.tabId === 'number' ? d.tabId : undefined,
    url: typeof d.url === 'string' ? d.url : undefined,
    title: typeof d.title === 'string' ? d.title : undefined,
    pageState: typeof d.pageState === 'string' ? d.pageState : undefined,
    grouped: d.grouped === true,
  };
}

function parseCloseTabPayload(data: unknown): CloseTabPayload {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    closedTabId: typeof d.closedTabId === 'number' ? d.closedTabId : undefined,
    focusedTabId: typeof d.focusedTabId === 'number' ? d.focusedTabId : null,
  };
}

function parseListTabsPayload(data: unknown): TabListItem[] {
  const raw = (data as { tabs?: unknown } | null | undefined)?.tabs;
  if (!Array.isArray(raw)) return [];
  const items: TabListItem[] = [];
  for (const entry of raw) {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (typeof item.tabId !== 'number') continue;
    items.push({
      tabId: item.tabId,
      url: typeof item.url === 'string' ? item.url : '',
      title: typeof item.title === 'string' ? item.title : '',
      focused: item.focused === true,
    });
  }
  return items;
}

export function createExtensionTabToolDefs(deps: ExtensionTabToolDeps): ToolDef[] {
  const { conversationId, acquireGate, isErrorResult, textResult, emitAction, scopeNote } = deps;
  const taskMeta = () => buildTaskMeta(conversationId);
  const logger = mainLogger.child('extension-tab-tools');

  return [
    defineTool(
      'dogear__extension__open_tab',
      '在用户浏览器新开标签页并设为操作焦点',
      `${scopeNote}\n` +
        '在用户浏览器新开标签页打开目标 URL（加入 Dogear 分组），导航不受域名限制（支付与网银域名禁用）；打开后即成为操作焦点。' +
        `单会话最多同时持有 ${MAX_TABS_PER_SESSION} 个标签页，超限时调用会被拒绝，需先 close_tab 释放。` +
        'background=true 时在后台打开（不抢占用户正在看的页面），但仍成为操作焦点。' +
        '受节奏保护的站点（如小红书）打开前会自动等待随机时长，搜索类 URL 另计会话搜索预算（超限拒绝）。' +
        '后续 observe_page / click / fill / read_* 等页面操作都作用于焦点标签页。',
      z.object({
        url: z.string().describe('目标页面完整 URL（含 http/https）'),
        background: z.boolean().optional().describe('后台打开（默认 false，前台打开并切换过去）'),
      }),
      async (args) => {
        const busy = acquireGate('open_tab', args.url);
        if (busy) return busy;
        if (isPaymentBlocked(args.url)) {
          return isErrorResult(paymentBlockedMessage());
        }
        const status = getExtensionStatus();
        if (status.status !== 'connected') {
          return isErrorResult(ERROR_MESSAGES.not_connected);
        }
        const precheck = validateNavigateTarget(args.url);
        if (precheck) {
          return isErrorResult(commandErrorMessage(precheck));
        }
        const openTabCount = status.tabs.length;
        if (openTabCount >= MAX_TABS_PER_SESSION) {
          logger.warn(`open_tab 触发标签页上限: conv=${conversationId ?? '__adhoc__'} 当前=${openTabCount}/${MAX_TABS_PER_SESSION} url=${args.url}`);
          emitAction('open_tab', { detail: args.url, result: 'tab_limit' });
          return isErrorResult(tabLimitReachedMessage(openTabCount));
        }
        const gate = await navigateGate(conversationId, args.url);
        if ('blocked' in gate) {
          emitAction('open_tab', {
            detail: args.url,
            result: gate.reason === 'risk' ? 'risk_blocked' : 'budget_exceeded',
          });
          return isErrorResult(gate.blocked);
        }
        const startedAt = Date.now();
        const r = await runCommand(
          'open_tab',
          args.background !== undefined ? { targetUrl: args.url, background: args.background } : { targetUrl: args.url },
          parseOpenTabPayload,
        );
        if (!r.ok) {
          emitAction('open_tab', {
            detail: args.url,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`打开标签页失败：${r.message}`);
        }
        if (gate.isSearch) consumeSearch(conversationId);
        const tab = r.value;
        const finalUrl = tab.url ?? args.url;
        emitAction('open_tab', {
          url: finalUrl,
          detail: args.url,
          result: 'opened',
          ...(finalUrl !== args.url ? { urlAfter: finalUrl } : {}),
          durationMs: Date.now() - startedAt,
        });
        const redirectNote = finalUrl !== args.url ? `（重定向到 ${finalUrl}）` : '';
        const titleNote = tab.title ? `\n标题: ${tab.title}` : '';
        const pointer = siteKnowledgePointer(finalUrl);
        const policyTip = sitePolicyPointer(finalUrl);
        const groupNote =
          tab.grouped === false
            ? `\n⚠ 新标签页未能加入 Dogear 分组（原因见扩展 Service Worker console 的 [dogear] 日志），close_tab / list_tabs 将无法管理它。`
            : '';
        return textResult(
          `已在新标签页打开目标页面（tabId ${tab.tabId ?? '未知'}${redirectNote}）。${titleNote}\n` +
            `状态: ${tab.pageState ?? 'ready'}${pageStateSuffix(tab.pageState)}${groupNote}\n` +
            `新标签页已设为操作焦点，observe_page / click / fill 等页面操作将作用于它，请先 observe_page 获取元素。${pointer ?? ''}${policyTip ?? ''}`,
        );
      },
    ),

    defineTool(
      'dogear__extension__close_tab',
      '关闭用户浏览器 Dogear 分组内标签页',
      `${scopeNote}\n` +
        '关闭 Dogear 分组内标签页：不传 tab_id 关闭当前操作焦点标签页；传 tab_id 关闭组内指定标签页（非焦点 tab 的 tabId 用 list_tabs 查询）。' +
        '关闭焦点标签页后操作焦点自动回落到组内最近使用的标签页；组内最后一个也被关闭后分组为空，需先 open_tab 重新打开。',
      z.object({
        tab_id: z.number().int().optional().describe('要关闭的标签页 tabId；不传则关闭当前焦点标签页'),
      }),
      async (args) => {
        const status = getExtensionStatus();
        const connected = status.status === 'connected';
        const focusTabId = connected ? status.tabId : undefined;
        if (args.tab_id === undefined) {
          if (!connected) return isErrorResult(ERROR_MESSAGES.not_connected);
          if (focusTabId === NO_FOCUS_TAB_ID) return isErrorResult(EMPTY_GROUP_MESSAGE);
        }
        const busy = acquireGate(
          'close_tab',
          args.tab_id !== undefined ? `tabId ${args.tab_id}` : '焦点标签页',
          connected ? status.url : undefined,
        );
        if (busy) return busy;
        const wasFocus = (args.tab_id ?? focusTabId) === focusTabId;
        const closedUrl = connected
          ? (status.tabs.find((t) => t.tabId === args.tab_id)?.url ?? (wasFocus ? status.url : undefined))
          : undefined;
        const startedAt = Date.now();
        const r = await runCommand(
          'close_tab',
          args.tab_id !== undefined ? { targetTabId: args.tab_id } : {},
          parseCloseTabPayload,
        );
        if (!r.ok) {
          emitAction('close_tab', {
            url: closedUrl,
            detail: `tabId ${args.tab_id ?? '焦点'}`,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`关闭标签页失败：${r.message}`);
        }
        const closedTabId = r.value.closedTabId ?? args.tab_id;
        emitAction('close_tab', {
          url: closedUrl,
          detail: `tabId ${closedTabId ?? '未知'}`,
          result: 'closed',
          durationMs: Date.now() - startedAt,
        });
        let focusNote: string;
        if (wasFocus && r.value.focusedTabId === null) {
          focusNote = `Dogear 分组已空，后续页面操作请先 open_tab`;
        } else if (wasFocus) {
          focusNote = `操作焦点已回落到 tabId ${r.value.focusedTabId}，后续页面操作将作用于它，请先 observe_page`;
        } else {
          focusNote = `该标签页非操作焦点，操作焦点不变（tabId ${focusTabId}）`;
        }
        const urlNote = closedUrl ? `，原地址 ${closedUrl}` : '';
        return textResult(`已关闭标签页（tabId ${closedTabId ?? '未知'}${urlNote}）。${focusNote}`);
      },
    ),

    defineTool(
      'dogear__extension__list_tabs',
      '列出用户浏览器 Dogear 分组内标签页',
      `${scopeNote}\n` +
        '列出 Dogear 分组内全部标签页（tabId / 地址 / 标题 / 焦点标记），无页面交互、不受站点策略约束。' +
        '非焦点标签页只有摘要信息（无正文预览），读取其正文需先使其成为操作焦点：请用户在浏览器中切换到该标签页；' +
        '或直接 open_tab 重新打开目标地址（新开页即焦点）。',
      z.object({}),
      async () => {
        const busy = acquireGate('list_tabs', '分组标签页', undefined);
        if (busy) return busy;
        const startedAt = Date.now();
        const r = await runCommand('list_tabs', {}, parseListTabsPayload);
        if (!r.ok) {
          emitAction('list_tabs', {
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`列出标签页失败：${r.message}`);
        }
        const tabs = r.value;
        emitAction('list_tabs', {
          detail: `${tabs.length} 个标签页`,
          result: 'listed',
          durationMs: Date.now() - startedAt,
        });
        if (tabs.length === 0) return textResult(EMPTY_GROUP_MESSAGE);
        const lines = tabs.map((t) => {
          const focusMark = t.focused ? '[焦点] ' : '';
          const title = t.title ? ` ${t.title}` : '';
          return `- ${focusMark}tabId ${t.tabId}${title}\n  ${t.url}`;
        });
        return textResult(
          `Dogear 分组内共 ${tabs.length} 个标签页：\n${lines.join('\n')}\n\n` +
            '页面操作只作用于焦点标签页；非焦点标签页只有摘要，读取正文请让用户切换到该标签页或用 open_tab 重开。',
        );
      },
    ),
  ];
}
