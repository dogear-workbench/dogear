/**
 * 页面导航与整页读取工具：navigate / readArticle / screenshot
 *
 * 从 extension-tools 拆出。闭包前置（meta/acquireGate/wallGate 等）经 ExtensionToolContext 注入；
 * screenshot 的截图回包解析（CapturePayload/parseCapturePayload）为该工具独用，随工具落在本文件。
 */

import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getExtensionStatus } from '../../services/browser/browser-gateway.js';
import {
  checkNoteBudget,
  consumeNote,
  consumeSearch,
  isPaymentBlocked,
  navigateGate,
  paymentBlockedMessage,
  policyGate,
  riskSignalMessage,
  scanAndMarkRisk,
} from '../../services/browser/site-policy.js';
import { blockedDomainMessage, findBlockedEntry } from '../../services/browser/browser-blocklist-service.js';
import { parseArticleHtml } from '../../services/article/parse.js';
import { injectionWarningPrefix, INJECTION_SCAN_NOTE, scanInjection } from '../../services/browser/injection-scan.js';
import { NO_FOCUS_TAB_ID } from '../../services/browser/gateway-tab-state.js';
import {
  currentUrl,
  emitAction,
  EMPTY_GROUP_MESSAGE,
  ERROR_MESSAGES,
  isErrorResult,
  markActionDone,
  paceActionGate,
  runCommand,
  textResult,
} from './extension-command-shared.js';
import { pageStateSuffix, type ReadArticlePayload } from './extension-observe-format.js';
import { siteKnowledgePointer, sitePolicyPointer } from './extension-site-tools.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { policyLogger, reasonOf, type ExtensionToolContext } from './extension-tool-context.js';

interface CapturePayload {
  dataUrl?: string;
  url?: string;
  title?: string;
}

function parseCapturePayload(data: unknown): CapturePayload {
  return (data ?? {}) as CapturePayload;
}

export function createNavToolDefs(ctx: ExtensionToolContext): ToolDef[] {
  const { conversationId, meta, acquireGate, wallGate, scopeNote, workspacePath } = ctx;
  return [
    defineTool(
      'dogear__extension__navigate',
      '让用户浏览器导航到指定 URL',
      `${scopeNote}\n` +
        '让受控标签页导航到目标 URL，导航不受域名限制（支付与网银域名禁用）。' +
        '用户已屏蔽的站点会被拒绝（返回屏蔽提示，改用其他来源，不要再尝试该站）。' +
        '小红书搜索可直达 https://www.xiaohongshu.com/search_result?keyword=关键词。' +
        '受节奏保护的站点（如小红书）导航前会自动等待随机时长，搜索导航另计入会话搜索预算（超限拒绝）。' +
        '导航后旧元素引用失效，需重新 observe_page。',
      z.object({
        url: z.string().describe('目标页面完整 URL（含 http/https）'),
      }),
      async (args) => {
        const busy = acquireGate('navigate', args.url);
        if (busy) return busy;
        const blocked = await findBlockedEntry(args.url);
        if (blocked) {
          emitAction(meta(), 'navigate', { url: currentUrl(), detail: args.url, result: 'blocked' });
          return isErrorResult(blockedDomainMessage(blocked));
        }
        if (isPaymentBlocked(args.url)) {
          return isErrorResult(paymentBlockedMessage());
        }
        const taskMeta = meta();
        await paceActionGate(conversationId);
        const gate = await navigateGate(conversationId, args.url);
        if ('blocked' in gate) {
          if (gate.reason === 'budget') {
            policyLogger.warn(`navigate 搜索预算拒绝: conv=${conversationId ?? '__adhoc__'} url=${args.url}`);
          }
          emitAction(taskMeta, 'navigate', {
            url: currentUrl(),
            detail: args.url,
            result: gate.reason === 'risk' ? 'risk_blocked' : 'budget_exceeded',
          });
          return isErrorResult(gate.blocked);
        }
        const urlBefore = currentUrl();
        const startedAt = Date.now();
        const r = await runCommand('navigate', { targetUrl: args.url }, (data) => {
          const d = (data ?? {}) as { url?: unknown; title?: unknown; pageState?: unknown };
          return {
            url: typeof d.url === 'string' ? d.url : undefined,
            title: typeof d.title === 'string' ? d.title : undefined,
            pageState: typeof d.pageState === 'string' ? d.pageState : undefined,
          };
        });
        markActionDone(conversationId);
        if (!r.ok) {
          emitAction(taskMeta, 'navigate', {
            url: urlBefore,
            detail: args.url,
            result: 'error',
            urlBefore,
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`导航失败：${r.message}`);
        }
        if (gate.isSearch) consumeSearch(conversationId);
        const nav = r.value;
        const urlAfter = nav.url ?? currentUrl();
        emitAction(taskMeta, 'navigate', {
          url: urlAfter,
          detail: args.url,
          result: 'navigated',
          urlBefore,
          ...(urlAfter ? { urlAfter } : {}),
          durationMs: Date.now() - startedAt,
        });
        const wall = await wallGate(
          nav.pageState,
          urlAfter || args.url,
          undefined,
          '登录前的导航已完成，无需重复 navigate；请调用 observe_page 获取页面元素后继续任务',
        );
        if (wall) return wall;
        const redirectNote = urlAfter && urlAfter !== args.url ? `（发生重定向，最终地址 ${urlAfter}）` : '';
        const pointer = siteKnowledgePointer(urlAfter ?? args.url);
        const policyTip = sitePolicyPointer(urlAfter ?? args.url);
        const titleNote = nav.title ? `\n标题: ${nav.title}` : '';
        return textResult(
          `已在用户浏览器打开目标页面${redirectNote}。${titleNote}\n状态: ${nav.pageState ?? 'ready'}${pageStateSuffix(nav.pageState)}` +
            `\n旧页面元素引用已失效，请先 observe_page 获取新页面元素。${pointer ?? ''}${policyTip ?? ''}`,
        );
      },
    ),

    defineTool(
      'dogear__extension__readArticle',
      '读取用户浏览器当前页面的文章正文（Markdown）',
      `${scopeNote}\n` +
        '把受控标签页当前渲染后的页面交由桌面端解析（Readability + Turndown），返回标题/作者/来源/字数与 Markdown 正文。' +
        '适合登录态文章站（公众号/知乎专栏等）：页面已在用户浏览器带登录态渲染完成，一键抽正文；' +
        '可选 selector 限定正文容器（如 "article" "#js_content"），不传则自动识别。' +
        '需要留存到文章库时，把返回的标题/来源/正文传给 dogear__extension__save_article。' +
        '读取的是当前页面：先用 navigate/observe 确认页面已加载完成再调用；当前站点已被用户屏蔽时直接拒绝。' +
        '解析失败（非文章页/正文过短）时改用 observe_page / read_text 手动提取。' +
        '受节奏保护的站点（如小红书）计入会话笔记预算（超限拒绝）。' +
        INJECTION_SCAN_NOTE,
      z.object({
        selector: z.string().optional().describe('正文容器 CSS 选择器；不传自动识别正文'),
      }),
      async (args) => {
        const detail = args.selector ?? 'auto';
        const busy = acquireGate('parse', detail, currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        const blocked = pageUrl ? await findBlockedEntry(pageUrl) : null;
        if (blocked) {
          emitAction(taskMeta, 'parse', { url: pageUrl, detail, result: 'blocked' });
          return isErrorResult(blockedDomainMessage(blocked));
        }
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'parse', { url: pageUrl, detail, result: 'risk_blocked' });
          return isErrorResult(gate.blocked);
        }
        if (gate.ctx) {
          const budgetMessage = checkNoteBudget(conversationId, gate.ctx.policy);
          if (budgetMessage) {
            policyLogger.warn(`readArticle 笔记预算拒绝: conv=${conversationId ?? '__adhoc__'} url=${pageUrl ?? ''}`);
            emitAction(taskMeta, 'parse', { url: pageUrl, detail, result: 'budget_exceeded' });
            return isErrorResult(budgetMessage);
          }
        }
        const startedAt = Date.now();
        const r = await runCommand(
          'readArticle',
          { selector: args.selector },
          (data) => (data ?? {}) as ReadArticlePayload,
        );
        if (!r.ok) {
          emitAction(taskMeta, 'parse', {
            url: pageUrl,
            detail,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          if (r.errorCode === 'value_mismatch') {
            return isErrorResult(reasonOf(r.data) ?? r.message);
          }
          return isErrorResult(`读取失败：${r.message}`);
        }
        const v = r.value;
        const articleUrl = v.url ?? pageUrl ?? '';
        if (!v.html) {
          emitAction(taskMeta, 'parse', { url: articleUrl, detail, result: 'empty_html', durationMs: Date.now() - startedAt });
          return isErrorResult('未能从页面取得内容（页面可能仍在加载或为空），请确认页面加载完成后重试');
        }
        const wall = await wallGate(
          v.pageState,
          articleUrl,
          v.tabId,
          '请重新调用 readArticle 提取正文；若解析仍失败，用 observe_page / read_text 手动提取',
        );
        if (wall) return wall;
        let parsed;
        try {
          parsed = parseArticleHtml(v.html, articleUrl, v.containerHtml);
        } catch (err) {
          emitAction(taskMeta, 'parse', {
            url: articleUrl,
            detail,
            result: 'parse_empty',
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(
            `解析失败：${err instanceof Error ? err.message : String(err)}。页面可能不是文章页，可用 observe_page / read_text 手动提取`,
          );
        }
        if (gate.ctx) {
          const hits = scanAndMarkRisk(conversationId, gate.ctx, parsed.content);
          if (hits) {
            emitAction(taskMeta, 'parse', {
              url: articleUrl,
              detail,
              result: 'risk_signal',
              durationMs: Date.now() - startedAt,
            });
            return isErrorResult(riskSignalMessage(hits));
          }
          consumeNote(conversationId);
        }
        emitAction(taskMeta, 'parse', {
          url: articleUrl,
          detail: parsed.title,
          result: `wordCount=${parsed.wordCount}`,
          durationMs: Date.now() - startedAt,
        });
        const header =
          `📄 文章读取成功\n标题: ${parsed.title}\n作者: ${parsed.author || '未知'}\n来源: ${parsed.siteName || '未知'}\n最终 URL: ${articleUrl}\n字数: ${parsed.wordCount}`;
        return textResult(`${injectionWarningPrefix(scanInjection(parsed.content))}${header}\n\n--- 正文 ---\n\n${parsed.content}`);
      },
    ),

    defineTool(
      'dogear__extension__screenshot',
      '截取用户浏览器页面截图',
      `${scopeNote}\n` +
        '对 Dogear 标签页截取视口截图，保存为 PNG 并返回路径。查看图片：把返回的路径传给 read 工具即可（read 原生支持图片附件）。' +
        '不传 tab_id 截当前操作焦点标签页；传 tab_id 可截 agent 窗口内其他标签页（tabId 用 list_tabs 查询）。' +
        '截取非激活标签页时会瞬时切到该标签页再切回，用户屏幕有短暂闪动，属正常现象不要重试。' +
        '截图不产生页面网络请求，不计站点策略预算；浏览器内部页（chrome:// 等）无法截取。' +
        '文件保存在工作区 .dogear/tmp/ 下，确认不再需要时可自行删除。',
      z.object({
        tab_id: z.number().int().optional().describe('要截取的标签页 tabId；不传则截当前焦点标签页'),
      }),
      async (args) => {
        const status = getExtensionStatus();
        if (status.status !== 'connected') {
          return isErrorResult(ERROR_MESSAGES.not_connected);
        }
        if (args.tab_id === undefined && status.tabId === NO_FOCUS_TAB_ID) {
          return isErrorResult(EMPTY_GROUP_MESSAGE);
        }
        let targetTabId = status.tabId;
        let targetUrl: string | undefined = status.url;
        if (args.tab_id !== undefined) {
          const entry = status.tabs.find((t) => t.tabId === args.tab_id);
          if (!entry) {
            return isErrorResult(`tabId ${args.tab_id} 不在 Dogear 可操作范围内，请先用 list_tabs 查询可用标签页`);
          }
          targetTabId = entry.tabId;
          targetUrl = entry.url || undefined;
        }
        const busy = acquireGate('screenshot', `tabId ${targetTabId}`, targetUrl);
        if (busy) return busy;
        const taskMeta = meta();
        if (!workspacePath) {
          return isErrorResult('当前会话未关联工作区，无法提供 read 可读的截图路径');
        }
        const startedAt = Date.now();
        const r = await runCommand(
          'capture',
          args.tab_id !== undefined ? { tabId: args.tab_id } : {},
          parseCapturePayload,
          undefined,
          { tabId: targetTabId },
        );
        if (!r.ok) {
          emitAction(taskMeta, 'screenshot', {
            url: targetUrl,
            detail: `tabId ${targetTabId}`,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`截图失败：${r.message}`);
        }
        const v = r.value;
        const base64 = v.dataUrl?.includes(',') ? v.dataUrl.slice(v.dataUrl.indexOf(',') + 1) : v.dataUrl;
        if (!base64) {
          emitAction(taskMeta, 'screenshot', {
            url: v.url ?? targetUrl,
            detail: `tabId ${targetTabId}`,
            result: 'error',
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult('扩展未返回截图数据，请重试');
        }
        try {
          const dir = path.join(workspacePath, '.dogear', 'tmp');
          await fs.mkdir(dir, { recursive: true });
          const file = path.join(dir, `dogear-extension-${Date.now()}.png`);
          await fs.writeFile(file, Buffer.from(base64, 'base64'));
          emitAction(taskMeta, 'screenshot', {
            url: v.url ?? targetUrl,
            detail: v.title ? `${v.title}（tabId ${targetTabId}）` : `tabId ${targetTabId}`,
            result: file,
            durationMs: Date.now() - startedAt,
          });
          const titleNote = v.title ? `\n标题: ${v.title}` : '';
          return textResult(
            `截图已保存: ${file}\n页面: ${v.url ?? targetUrl ?? ''}${titleNote}\n用 read 工具读取该路径即可查看图片。`,
          );
        } catch (err) {
          emitAction(taskMeta, 'screenshot', {
            url: v.url ?? targetUrl,
            detail: `tabId ${targetTabId}`,
            result: 'error',
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`截图保存失败：${err instanceof Error ? err.message : String(err)}`);
        }
      },
    ),
  ];
}
