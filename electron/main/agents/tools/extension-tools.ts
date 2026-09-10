/**
 * 浏览器扩展 MCP Server 工具
 *
 * 提供 dogear__extension__* 工具组：navigate / observe_page / click / fill / read_text / read_state /
 * site_knowledge / site_finding（后两者在 extension-site-tools.ts）。
 * 作用于用户真实浏览器的已连接标签页（经 NativeMessaging 通道 sendExtensionCommand），
 * 仅限已授权域名；点击/填充自动执行但拦截提交类操作（扩展侧 guard 硬护栏）。
 * 站点策略命中（如小红书）：操作间随机延迟、单会话搜索/笔记预算、风控信号即停。
 * site_knowledge / site_finding 读写站点档案无页面交互，不过站点策略。
 * 错误一律转中文 isError 文案不抛异常（13 个 errorCode 映射全覆盖）。
 */

import { z } from 'zod';
import {
  getExtensionStatus,
  sendExtensionCommand,
  type CommandError,
} from '../../services/browser/browser-gateway.js';
import { recordBrowserAction } from '../../services/browser/browser-action-stream.js';
import type { BrowserActionType } from '../../services/browser/browser-action-stream.js';
import { acquireChannel, resetChannel } from '../../services/browser/extension-ownership.js';
import type { BrowserTaskMeta } from '../../services/browser/browser-task-meta.js';
import type { CommandErrorCode, CommandKind } from '../../services/browser/nm-protocol.js';
import {
  checkNoteBudget,
  checkSearchBudget,
  consumeNote,
  consumeSearch,
  navigateGate,
  policyGate,
  riskSignalMessage,
  scanAndMarkRisk,
  type PolicyGateContext,
} from '../../services/browser/site-policy.js';
import { createSiteToolDefs, siteKnowledgePointer } from './extension-site-tools.js';
import {
  formatObserve,
  formatObserveElement,
  parseFindPayload,
  parseObservePayload,
  pageStateSuffix,
  type ClickPayload,
  type FindPayload,
  type ObservePayload,
  type ReadStatePayload,
  type ReadTextPayload,
  type ScrollPayload,
} from './extension-observe-format.js';
import { pageStateHint } from '../../services/browser/embedded/page-state.js';
import type { EmbeddedPageState } from '../../services/browser/embedded/types.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef, type ToolResult } from '../pi/tool-adapter.js';

const READ_MAX_CHARS = 8_000;

const ERROR_MESSAGES: Record<CommandErrorCode, string> = {
  not_connected: '浏览器扩展未连接，请先在扩展中连接此标签页',
  stale_protocol: '扩展版本过旧，请在浏览器扩展管理页重载 Dogear 扩展后重试',
  timeout: '命令执行超时（30s 上限），请重试',
  disconnected: '扩展连接已断开，请在扩展中重新连接此标签页',
  stale_tab: '当前受控标签页已切换，请在扩展中重新连接目标标签页',
  navigated_away: '页面已离开命令发起时的地址，请重新调用 observe_page 后再操作',
  tab_closed: '标签页已关闭，请在扩展中重新连接目标标签页',
  permission_denied: '当前标签页域名未授权，请在浏览器扩展 Dogear 弹窗中授权此域名后重试',
  ref_expired: '页面已变化，请重新调用 observe_page 获取新 ref',
  value_mismatch: '填写后页面当前值与输入不一致（页面可能改写了内容），请检查后重试',
  guard_password: '密码类输入本阶段禁止，请手动填写密码',
  guard_submit: '提交类操作本阶段未开放，请手动完成提交',
  navigation_blocked: '目标域名未授权，请在扩展弹窗授权后重试',
};

function commandErrorMessage(err: unknown): string {
  const e = (err ?? null) as Partial<CommandError> | null;
  const code = e?.errorCode;
  const detail = typeof e?.error === 'string' && e.error ? e.error : undefined;
  const currentUrl = typeof e?.currentUrl === 'string' && e.currentUrl ? e.currentUrl : undefined;
  if (code === 'navigated_away' || code === 'ref_expired') {
    const base = ERROR_MESSAGES[code];
    return currentUrl ? `${base}（当前页面: ${currentUrl}）` : base;
  }
  if (code === 'navigation_blocked') {
    if (!detail || detail.includes('目标域名未授权')) return ERROR_MESSAGES.navigation_blocked;
    return `无法导航：${detail}`;
  }
  if (typeof code === 'string' && code in ERROR_MESSAGES) {
    return ERROR_MESSAGES[code as CommandErrorCode];
  }
  return `浏览器扩展命令执行失败：${detail ?? String(err)}`;
}

function isErrorResult(message: string): ToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text' as const, text }] };
}

function buildTaskMeta(conversationId: string | undefined): BrowserTaskMeta {
  return conversationId ? { kind: 'agent', conversationId } : { kind: 'agent' };
}

function currentUrl(): string | undefined {
  const status = getExtensionStatus();
  return status.status === 'connected' ? status.url : undefined;
}

interface ActionExtra {
  url?: string;
  detail?: string;
  result?: string;
  urlBefore?: string;
  urlAfter?: string;
  errorCode?: string;
  durationMs?: number;
}

function emitAction(
  taskMeta: BrowserTaskMeta,
  action: BrowserActionType,
  extra?: ActionExtra,
): void {
  recordBrowserAction({
    source: 'extension',
    taskMeta,
    action,
    ...extra,
  });
}

/** read_state 笔记预算按页面 URL 计数（同页多 path 探索不重复计）；与 read_text 的「无 ref 计数」语义互不影响 */
const readStateCountedUrlByConv = new Map<string, string>();

async function runCommand<T>(
  kind: CommandKind,
  params: Record<string, unknown>,
  extract: (data: unknown) => T,
): Promise<{ ok: true; value: T } | { ok: false; message: string; errorCode?: string }> {
  try {
    const result = await sendExtensionCommand(kind, params);
    return { ok: true, value: extract(result.data) };
  } catch (err) {
    const errorCode = (err as Partial<CommandError> | null)?.errorCode;
    return {
      ok: false,
      message: commandErrorMessage(err),
      ...(typeof errorCode === 'string' ? { errorCode } : {}),
    };
  }
}

function busyChannelMessage(idleMs: number): string {
  const minutes = Math.max(1, Math.floor(idleMs / 60_000));
  return `扩展通道正被另一个会话使用（对方最近活动于 ${minutes} 分钟前），通道空闲 10 分钟后自动释放；若需并行调研，请改串行派遣或使用内嵌浏览器工具`;
}

function formatClick(ref: string, data: ClickPayload): string {
  if (data.verification === 'lost') {
    return `已点击 ${ref} 并触发导航，当前页面: ${data.urlAfter ?? '未知'}（点击结果验证数据已丢失）。旧元素引用已失效，操作新页面请重新 observe_page。`;
  }
  const changes: string[] = [];
  if (data.urlAfter && data.urlBefore && data.urlAfter !== data.urlBefore) {
    changes.push(
      `已触发导航：${data.urlBefore} → ${data.urlAfter}（旧元素引用已失效，操作新页面请重新 observe_page）`,
    );
  }
  if (data.elementGone) changes.push('目标元素已从页面消失');
  if (
    typeof data.textAfter === 'number' &&
    typeof data.textBefore === 'number' &&
    data.textAfter !== data.textBefore
  ) {
    changes.push(`正文字数 ${data.textBefore} → ${data.textAfter}`);
  }
  if (changes.length === 0) changes.push('页面无明显变化（可能为无效果点击）');
  return `已点击 ${ref}。验证：${changes.join('；')}`;
}

const SHARED_SCOPE_NOTE =
  '作用于用户真实浏览器的已连接标签页，仅限已授权域名；点击/填充自动执行但拦截提交类操作。' +
  '扩展通道同一时间仅一个会话可用，被其他会话占用时会直接报错（不排队）。' +
  '用户浏览器已连接且目标站需登录态时优先本工具组，公开网页读取用 dogear__browser__*。';

export function createExtensionToolDefs(opts?: { conversationId?: string }): ToolDef[] {
  const conversationId = opts?.conversationId;
  const meta = () => buildTaskMeta(conversationId);

  /** 各 handler 统一前置：断连清零独占 → 有 conversationId 时获取通道（busy 即拒，不排队）；action 为 null 的非页面操作（站点档案读写）busy 不记动作流 */
  function acquireGate(action: BrowserActionType | null, detail: string, url?: string): ToolResult | null {
    if (getExtensionStatus().status === 'disconnected') resetChannel();
    if (!conversationId) return null;
    const r = acquireChannel(conversationId, Date.now());
    if (r.ok) return null;
    if (action) {
      emitAction(meta(), action, { ...(url !== undefined ? { url } : {}), detail, result: 'busy' });
    }
    return isErrorResult(busyChannelMessage(r.idleMs));
  }

  return [
    defineTool(
      'dogear__extension__navigate',
      '让用户浏览器导航到指定 URL',
      `${SHARED_SCOPE_NOTE}\n` +
        '让受控标签页导航到目标 URL，需目标域名已在扩展弹窗授权。' +
        '小红书搜索可直达 https://www.xiaohongshu.com/search_result?keyword=关键词。' +
        '受节奏保护的站点（如小红书）导航前会自动等待随机时长，搜索导航另计入会话搜索预算（超限拒绝）。' +
        '导航后旧元素引用失效，需重新 observe_page。',
      z.object({
        url: z.string().describe('目标页面完整 URL（含 http/https）'),
      }),
      async (args) => {
        const busy = acquireGate('navigate', args.url);
        if (busy) return busy;
        const taskMeta = meta();
        const gate = await navigateGate(conversationId, args.url);
        if ('blocked' in gate) {
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
        const redirectNote = urlAfter && urlAfter !== args.url ? `（发生重定向，最终地址 ${urlAfter}）` : '';
        const pointer = siteKnowledgePointer(urlAfter ?? args.url);
        const titleNote = nav.title ? `\n标题: ${nav.title}` : '';
        return textResult(
          `已在用户浏览器打开目标页面${redirectNote}。${titleNote}\n状态: ${nav.pageState ?? 'ready'}${pageStateSuffix(nav.pageState)}` +
            `\n旧页面元素引用已失效，请先 observe_page 获取新页面元素。${pointer ?? ''}`,
        );
      },
    ),

    defineTool(
      'dogear__extension__observe_page',
      '列出用户浏览器页面的可交互元素',
      `${SHARED_SCOPE_NOTE}\n` +
        '列出当前已连接标签页中的可交互元素（DOM+ARIA 语义树），每条含 ref 编号、角色、文本与提示信息，链接带 href。' +
        '可交互元素全列不硬截断（超长页有安全阀）；另附标题结构与其余节点的 role 分级摘要。' +
        '可传 region（视口上/中/下分块）或 text_filter 缩小范围重查；超长列表也可用 find 按 role+name 精确查找。' +
        '页面导航后 ref 失效，需重新调用本工具。',
      z.object({
        region: z
          .enum(['top', 'middle', 'bottom'])
          .optional()
          .describe('按视口垂直位置过滤：top 上 1/3、middle 中 1/3、bottom 下 1/3'),
        text_filter: z.string().optional().describe('子串过滤：只返回文本或提示信息包含该子串的元素'),
      }),
      async (args) => {
        const busy = acquireGate('observe', args.text_filter || args.region || '', currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'observe', {
            url: pageUrl,
            detail: args.text_filter || args.region || '',
            result: 'risk_blocked',
          });
          return isErrorResult(gate.blocked);
        }
        const detail = args.text_filter || args.region || '';
        const startedAt = Date.now();
        const r = await runCommand('observe', { region: args.region, text_filter: args.text_filter }, parseObservePayload);
        if (!r.ok) {
          emitAction(taskMeta, 'observe', {
            url: pageUrl,
            detail,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`观察页面失败：${r.message}`);
        }
        const text = formatObserve(r.value);
        if (gate.ctx) {
          const hits = scanAndMarkRisk(conversationId, gate.ctx, text);
          if (hits) {
            emitAction(taskMeta, 'observe', {
              url: pageUrl,
              detail,
              result: 'risk_signal',
              durationMs: Date.now() - startedAt,
            });
            return isErrorResult(riskSignalMessage(hits));
          }
        }
        emitAction(taskMeta, 'observe', { url: pageUrl, detail, durationMs: Date.now() - startedAt });
        return textResult(text);
      },
    ),

    defineTool(
      'dogear__extension__find',
      '按 role+name 在用户浏览器页面中语义查找元素',
      `${SHARED_SCOPE_NOTE}\n` +
        '在当前页面的 DOM+ARIA 语义树中按 role（如 link/button/textbox/heading/combobox）与 name（元素文本）重新查找，' +
        '默认子串匹配，exact=true 时精确匹配；不依赖上次 observe_page 的结果，可发现未出现在其输出中的元素。' +
        '至少提供 role 或 name 之一。返回带可直接使用的 ref。页面导航后需重新查找。',
      z.object({
        role: z.string().optional().describe('语义角色，如 link、button、textbox、heading、combobox'),
        name: z.string().optional().describe('元素名称（可见文本）子串'),
        exact: z.boolean().optional().describe('name 是否精确匹配（默认子串包含）'),
        max_results: z.number().int().min(1).max(50).optional().describe('返回上限，默认 20，最大 50'),
      }),
      async (args) => {
        const busy = acquireGate('observe', [args.role, args.name].filter(Boolean).join(' '), currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const detail = [args.role, args.name].filter(Boolean).join(' ');
        if (!args.role && !args.name) {
          return isErrorResult('语义查找至少需要 role 或 name 参数');
        }
        const pageUrl = currentUrl();
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'observe', { url: pageUrl, detail, result: 'risk_blocked' });
          return isErrorResult(gate.blocked);
        }
        const startedAt = Date.now();
        const r = await runCommand(
          'find',
          { role: args.role, name: args.name, exact: args.exact, max_results: args.max_results },
          parseFindPayload,
        );
        if (!r.ok) {
          emitAction(taskMeta, 'observe', {
            url: pageUrl,
            detail,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`查找失败：${r.message}`);
        }
        const payload = r.value;
        if (payload.elements.length === 0) {
          emitAction(taskMeta, 'observe', { url: pageUrl, detail, durationMs: Date.now() - startedAt });
          return textResult(
            `未找到匹配元素（role=${args.role ?? '任意'}，name="${args.name ?? '任意'}"${args.exact ? '，精确匹配' : ''}）。\n` +
              `当前页面: ${payload.url ?? pageUrl ?? ''}（${payload.pageState ?? 'ready'}）。可放宽匹配条件、换近义词，或用 observe_page 查看页面全貌。`,
          );
        }
        const text = payload.elements.map(formatObserveElement).join('\n');
        if (gate.ctx) {
          const hits = scanAndMarkRisk(conversationId, gate.ctx, text);
          if (hits) {
            emitAction(taskMeta, 'observe', {
              url: pageUrl,
              detail,
              result: 'risk_signal',
              durationMs: Date.now() - startedAt,
            });
            return isErrorResult(riskSignalMessage(hits));
          }
        }
        emitAction(taskMeta, 'observe', { url: pageUrl, detail, durationMs: Date.now() - startedAt });
        return textResult(
          `找到 ${payload.elements.length} 个匹配元素（页面 ${payload.url ?? pageUrl ?? ''}，${payload.pageState ?? 'ready'}${payload.generation !== undefined ? `，generation ${payload.generation}` : ''}）：\n` +
            `${text}\n\nref 可直接用于 click/fill/scroll/read_text；页面导航后需重新查找。`,
        );
      },
    ),

    defineTool(
      'dogear__extension__click',
      '点击用户浏览器页面元素',
      `${SHARED_SCOPE_NOTE}\n` +
        '点击 observe_page 返回的 ref 对应元素，点击后自动附带轻量验证（URL 变化 / 元素消失 / 正文字数变化）。' +
        '提交类按钮会被拦截（guard_submit），需引导用户手动提交。',
      z.object({
        ref: z.string().describe('observe_page 返回的元素 ref（如 "e3@2"）'),
      }),
      async (args) => {
        const busy = acquireGate('click', args.ref, currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'click', { url: pageUrl, detail: args.ref, result: 'risk_blocked' });
          return isErrorResult(gate.blocked);
        }
        const startedAt = Date.now();
        const r = await runCommand('click', { ref: args.ref }, (data) => (data ?? {}) as ClickPayload);
        if (!r.ok) {
          emitAction(taskMeta, 'click', {
            url: pageUrl,
            detail: args.ref,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`点击失败：${r.message}`);
        }
        emitAction(taskMeta, 'click', {
          url: r.value.urlAfter ?? pageUrl,
          detail: args.ref,
          result: 'clicked',
          urlBefore: r.value.urlBefore,
          ...(r.value.urlAfter ? { urlAfter: r.value.urlAfter } : {}),
          durationMs: Date.now() - startedAt,
        });
        return textResult(formatClick(args.ref, r.value));
      },
    ),

    defineTool(
      'dogear__extension__fill',
      '填写用户浏览器页面输入框',
      `${SHARED_SCOPE_NOTE}\n` +
        '向 observe_page 返回的 ref 对应输入框填写文本（会清空原内容），填写后自动验证值是否生效。' +
        '密码类输入会被拦截（guard_password），需引导用户手动填写。',
      z.object({
        ref: z.string().describe('observe_page 返回的输入框 ref（如 "e2@3"）'),
        value: z.string().describe('要填写的文本'),
      }),
      async (args) => {
        const busy = acquireGate('fill', args.ref, currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'fill', { url: pageUrl, detail: args.ref, result: 'risk_blocked' });
          return isErrorResult(gate.blocked);
        }
        const startedAt = Date.now();
        const r = await runCommand('fill', { ref: args.ref, value: args.value }, () => undefined);
        if (!r.ok) {
          emitAction(taskMeta, 'fill', {
            url: pageUrl,
            detail: args.ref,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`填写失败：${r.message}`);
        }
        emitAction(taskMeta, 'fill', {
          url: pageUrl,
          detail: args.ref,
          result: 'filled',
          durationMs: Date.now() - startedAt,
        });
        return textResult(
          `已向 ${args.ref} 填写文本，值已生效。如需提交，请 observe_page 后查看提交按钮；` +
            `提交类操作会被拦截，请引导用户手动完成提交。`,
        );
      },
    ),

    defineTool(
      'dogear__extension__read_text',
      '读取用户浏览器页面元素或正文文本',
      `${SHARED_SCOPE_NOTE}\n` +
        '读取指定 ref 元素的纯文本；不传 ref 则读取正文容器（article/main 等中字数最大者）。' +
        '文本超过 8000 字符时截断并提示，可用 observe_page 定位子元素分次读取（带 ref 的分次读取不计笔记预算）。' +
        '受节奏保护的站点（如小红书）无 ref 读取计 1 篇笔记，计入会话笔记预算（超限拒绝）。',
      z.object({
        ref: z.string().optional().describe('要读取的元素 ref；不传则读正文容器'),
      }),
      async (args) => {
        const busy = acquireGate('read_text', args.ref || 'main', currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'read_text', {
            url: pageUrl,
            detail: args.ref || 'main',
            result: 'risk_blocked',
          });
          return isErrorResult(gate.blocked);
        }
        const detail = args.ref || 'main';
        const countAsNote = gate.ctx !== null && !args.ref;
        if (countAsNote && gate.ctx) {
          const budgetMessage = checkNoteBudget(conversationId, gate.ctx.policy);
          if (budgetMessage) {
            emitAction(taskMeta, 'read_text', { url: pageUrl, detail, result: 'budget_exceeded' });
            return isErrorResult(budgetMessage);
          }
        }
        const startedAt = Date.now();
        const r = await runCommand('read_text', { ref: args.ref }, (data) => (data ?? {}) as ReadTextPayload);
        if (!r.ok) {
          emitAction(taskMeta, 'read_text', {
            url: pageUrl,
            detail,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`读取失败：${r.message}`);
        }
        const text = r.value.text ?? '';
        if (gate.ctx) {
          const hits = scanAndMarkRisk(conversationId, gate.ctx, text);
          if (hits) {
            emitAction(taskMeta, 'read_text', {
              url: pageUrl,
              detail,
              result: 'risk_signal',
              durationMs: Date.now() - startedAt,
            });
            return isErrorResult(riskSignalMessage(hits));
          }
        }
        if (countAsNote) consumeNote(conversationId);
        const totalLength = typeof r.value.totalLength === 'number' ? r.value.totalLength : text.length;
        const truncated =
          totalLength > READ_MAX_CHARS
            ? `\n\n（已截断：原文共 ${totalLength} 字符，显示前 ${READ_MAX_CHARS}；可用 observe_page 定位子元素分次读取）`
            : '';
        emitAction(taskMeta, 'read_text', { url: pageUrl, detail, durationMs: Date.now() - startedAt });
        return textResult(`${text}${truncated}`);
      },
    ),

    defineTool(
      'dogear__extension__read_state',
      '读取用户浏览器页面 SPA 内存状态',
      `${SHARED_SCOPE_NOTE}\n` +
        '读取当前页面 window.__INITIAL_STATE__（小红书/知乎类 SPA 的数据源），双模式：' +
        '不传 path 返回顶层概要（每个 key 的类型/子项数或长度）；传 path（点分路径，纯数字段为数组下标）返回该子树 JSON（超 8000 字符截断）。' +
        '读内存 JSON 零网络请求，适合避开 feed 页重渲染与元素上限；页面无 __INITIAL_STATE__ 时明确报错。' +
        '小红书示例：搜索页数据在 __INITIAL_STATE__，先无 path 看顶层概要，再按 key 下钻到卡片数组。',
      z.object({
        path: z
          .string()
          .optional()
          .describe('点分路径（如 "home.feed.0"），纯数字段为数组下标；不传则返回顶层概要'),
      }),
      async (args) => {
        const detail = args.path || '顶层概要';
        const busy = acquireGate('read_state', detail, currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'read_state', { url: pageUrl, detail, result: 'risk_blocked' });
          return isErrorResult(gate.blocked);
        }
        const isNewPageUrl = pageUrl !== undefined && readStateCountedUrlByConv.get(conversationId ?? '') !== pageUrl;
        if (gate.ctx && isNewPageUrl) {
          const budgetMessage = checkNoteBudget(conversationId, gate.ctx.policy);
          if (budgetMessage) {
            emitAction(taskMeta, 'read_state', { url: pageUrl, detail, result: 'budget_exceeded' });
            return isErrorResult(budgetMessage);
          }
        }
        const startedAt = Date.now();
        const r = await runCommand('read_state', { path: args.path }, (data) => (data ?? {}) as ReadStatePayload);
        if (!r.ok) {
          emitAction(taskMeta, 'read_state', {
            url: pageUrl,
            detail,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`读取失败：${r.message}`);
        }
        const v = r.value;
        const failNote = (result: string, message: string): ToolResult => {
          emitAction(taskMeta, 'read_state', { url: pageUrl, detail, result, durationMs: Date.now() - startedAt });
          return isErrorResult(message);
        };
        if (v.missing) {
          return failNote(
            'missing_state',
            '本页无 __INITIAL_STATE__（非 SPA 页面或框架未挂载数据源），请改用 observe_page / read_text',
          );
        }
        if (v.notFound) {
          const keys = (v.availableKeys ?? [])
            .filter((k): k is string => typeof k === 'string')
            .join('、');
          return failNote(
            'path_not_found',
            `__INITIAL_STATE__ 中不存在路径 "${args.path}"（该层可用 key：${keys || '（无）'}），请修正 path 后重试`,
          );
        }
        if (v.notSerializable) {
          return failNote('not_serializable', '该子树无法 JSON 序列化（可能含循环引用），请换更深的子路径缩小范围后重试');
        }
        const text = v.summary ?? v.json ?? '';
        if (gate.ctx) {
          const hits = scanAndMarkRisk(conversationId, gate.ctx, text);
          if (hits) {
            emitAction(taskMeta, 'read_state', {
              url: pageUrl,
              detail,
              result: 'risk_signal',
              durationMs: Date.now() - startedAt,
            });
            return isErrorResult(riskSignalMessage(hits));
          }
        }
        if (gate.ctx && isNewPageUrl) {
          consumeNote(conversationId);
          readStateCountedUrlByConv.set(conversationId ?? '', pageUrl ?? '');
        }
        emitAction(taskMeta, 'read_state', { url: pageUrl, detail, durationMs: Date.now() - startedAt });
        if (v.summary !== undefined) {
          return textResult(
            `页面 __INITIAL_STATE__ 顶层概要：\n${v.summary || '（空对象）'}\n\n传 path（如 "key.subkey.0"）可下钻查看子树，纯数字段为数组下标。`,
          );
        }
        const truncatedNote =
          v.truncated && typeof v.totalLength === 'number'
            ? `\n\n（已截断：原文共 ${v.totalLength} 字符，显示前 8000；可换更深的子路径缩小范围）`
            : '';
        return textResult(`${text}${truncatedNote}`);
      },
    ),

    defineTool(
      'dogear__extension__scroll',
      '滚动用户浏览器页面或容器',
      `${SHARED_SCOPE_NOTE}\n` +
        '滚动受控标签页：不传 ref 滚动整个文档；传 ref 滚动该元素容器内部。' +
        'deltaY 相对滚动（像素，正向下/负向上），position="top"|"bottom" 精确滚到顶/底（deltaY 与 position 至少提供一个）。' +
        '返回滚动前后位置（before/after）与是否移动（moved）。适合翻页加载的 feed 流与长列表。',
      z.object({
        ref: z.string().optional().describe('要滚动的容器元素 ref（如 "e12@3"）；不传则滚动整个文档'),
        deltaY: z.number().min(-50_000).max(50_000).optional().describe('相对滚动像素（正向下，如 600；负值向上）'),
        position: z.enum(['top', 'bottom']).optional().describe('精确滚动到顶部/底部'),
      }),
      async (args) => {
        if (args.position === undefined && (args.deltaY === undefined || args.deltaY === 0)) {
          return isErrorResult('deltaY 与 position 至少提供一个，且 deltaY 不能为 0');
        }
        const detail = args.ref ?? (args.position ?? String(args.deltaY ?? ''));
        const busy = acquireGate('scroll', detail, currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'scroll', { url: pageUrl, detail, result: 'risk_blocked' });
          return isErrorResult(gate.blocked);
        }
        const startedAt = Date.now();
        const r = await runCommand(
          'scroll',
          { ref: args.ref, delta_y: args.deltaY, position: args.position },
          (data) => (data ?? {}) as ScrollPayload,
        );
        if (!r.ok) {
          emitAction(taskMeta, 'scroll', {
            url: pageUrl,
            detail,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(`滚动失败：${r.message}`);
        }
        const s = r.value;
        emitAction(taskMeta, 'scroll', { url: pageUrl, detail, result: 'scrolled', durationMs: Date.now() - startedAt });
        if (!s.before || !s.after) {
          return textResult(`已滚动${s.target === 'container' ? `容器（${args.ref}）` : '文档'}，但未能读取滚动位置。`);
        }
        const targetLabel = s.target === 'container' ? `容器（${args.ref}）` : '文档';
        const movedNote = s.moved ? '' : '；未产生滚动（可能已到边界、内容不足一屏或目标不可滚动）';
        return textResult(
          `已滚动${targetLabel}：scrollTop ${s.before.top} → ${s.after.top}${movedNote}。` +
            `内容总高 ${s.after.height}px，可视 ${s.after.clientHeight}px。${pageStateSuffix(s.pageState)}`,
        );
      },
    ),

    ...createSiteToolDefs({
      conversationId,
      acquireGate,
      currentUrl,
      isErrorResult,
      textResult,
      scopeNote: '扩展通道会话独占；本组工具只读写本地站点档案，不碰页面、不受授权域约束。',
    }),
  ];
}

registerToolGroup({
  server: 'dogear-extension',
  label: '浏览器扩展',
  create: createExtensionToolDefs,
  placeholder: [{}],
});
