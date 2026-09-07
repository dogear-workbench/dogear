/**
 * 浏览器扩展 MCP Server 工具
 *
 * 提供 dogear__extension__* 工具组：observe_page / click / fill / read_text。
 * 作用于用户真实浏览器的已连接标签页（经 NativeMessaging 通道 sendExtensionCommand），
 * 仅限已授权域名；点击/填充自动执行但拦截提交类操作（扩展侧 guard 硬护栏）。
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
import type { BrowserTaskMeta } from '../../services/browser/browser-manager.js';
import type { CommandErrorCode, CommandKind } from '../../services/browser/nm-protocol.js';
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
  const code = (err as Partial<CommandError> | null)?.errorCode;
  if (typeof code === 'string' && code in ERROR_MESSAGES) {
    return ERROR_MESSAGES[code as CommandErrorCode];
  }
  const detail = (err as Partial<CommandError> | null)?.error;
  return `浏览器扩展命令执行失败：${typeof detail === 'string' && detail ? detail : String(err)}`;
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

function emitAction(
  taskMeta: BrowserTaskMeta,
  action: BrowserActionType,
  extra?: { url?: string; detail?: string; result?: string },
): void {
  recordBrowserAction({
    source: 'extension',
    taskMeta,
    action,
    ...(extra?.url !== undefined ? { url: extra.url } : {}),
    ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
    ...(extra?.result !== undefined ? { result: extra.result } : {}),
  });
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

function parseObservePayload(data: unknown): ObservePayload {
  const raw = (data ?? {}) as Partial<ObservePayload>;
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  const counts = (raw.regionCounts ?? {}) as Partial<ObservePayload['regionCounts']>;
  return {
    total: typeof raw.total === 'number' ? raw.total : elements.length,
    regionCounts: {
      top: typeof counts.top === 'number' ? counts.top : 0,
      middle: typeof counts.middle === 'number' ? counts.middle : 0,
      bottom: typeof counts.bottom === 'number' ? counts.bottom : 0,
    },
    elements: elements.filter(
      (el): el is ObserveElement =>
        !!el && typeof el === 'object' && typeof (el as ObserveElement).ref === 'string',
    ),
  };
}

interface ClickPayload {
  urlBefore?: string;
  urlAfter?: string;
  elementGone?: boolean;
  textBefore?: number;
  textAfter?: number;
  clicked?: boolean;
  navigated?: boolean;
  verification?: string;
}

interface ReadTextPayload {
  text?: string;
  totalLength?: number;
}

async function runCommand<T>(
  kind: CommandKind,
  params: Record<string, unknown>,
  extract: (data: unknown) => T,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    const result = await sendExtensionCommand(kind, params);
    return { ok: true, value: extract(result.data) };
  } catch (err) {
    return { ok: false, message: commandErrorMessage(err) };
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
      `页面可交互元素（显示前 ${payload.elements.length} 个 / 共 ${payload.total} 个，超出显示上限 120）：\n` +
      `可传 region="top"|"middle"|"bottom"（各区域元素数：top ${payload.regionCounts.top} / middle ${payload.regionCounts.middle} / bottom ${payload.regionCounts.bottom}）或 text_filter 缩小范围重查。`;
  }
  return `${header}\n${lines.join('\n')}\n\nclick / fill / read_text 请使用上面的 ref 编号定位元素。`;
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
  '作用于用户真实浏览器的已连接标签页，仅限已授权域名；点击/填充自动执行但拦截提交类操作。';

export function createExtensionToolDefs(opts?: { conversationId?: string }): ToolDef[] {
  const conversationId = opts?.conversationId;
  const meta = () => buildTaskMeta(conversationId);

  return [
    defineTool(
      'dogear__extension__observe_page',
      '列出用户浏览器页面的可交互元素',
      `${SHARED_SCOPE_NOTE}\n` +
        '列出当前已连接标签页中可见的可交互元素（链接/按钮/输入框等），每条含 ref 编号、标签、角色、文本（截断 80 字）与提示信息。' +
        'ref 用于 click / fill / read_text 定位。元素最多 120 个，超出时传 region（视口上/中/下分块）或 text_filter 缩小范围重查。' +
        '页面导航后 ref 失效，需重新调用本工具。',
      z.object({
        region: z
          .enum(['top', 'middle', 'bottom'])
          .optional()
          .describe('按视口垂直位置过滤：top 上 1/3、middle 中 1/3、bottom 下 1/3'),
        text_filter: z.string().optional().describe('子串过滤：只返回文本或提示信息包含该子串的元素'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction(taskMeta, 'observe', {
          url: currentUrl(),
          detail: args.text_filter || args.region || '',
        });
        const r = await runCommand('observe', { region: args.region, text_filter: args.text_filter }, parseObservePayload);
        if (!r.ok) return isErrorResult(`观察页面失败：${r.message}`);
        return textResult(formatObserve(r.value));
      },
    ),

    defineTool(
      'dogear__extension__click',
      '点击用户浏览器页面元素',
      `${SHARED_SCOPE_NOTE}\n` +
        '点击 observe_page 返回的 ref 对应元素，点击后自动附带轻量验证（URL 变化 / 元素消失 / 正文字数变化）。' +
        '提交类按钮会被拦截（guard_submit），需引导用户手动提交。',
      z.object({
        ref: z.string().describe('observe_page 返回的元素 ref（如 "e3"）'),
      }),
      async (args) => {
        const taskMeta = meta();
        const r = await runCommand('click', { ref: args.ref }, (data) => (data ?? {}) as ClickPayload);
        if (!r.ok) {
          emitAction(taskMeta, 'click', { url: currentUrl(), detail: args.ref, result: 'error' });
          return isErrorResult(`点击失败：${r.message}`);
        }
        emitAction(taskMeta, 'click', {
          url: r.value.urlAfter ?? currentUrl(),
          detail: args.ref,
          result: 'clicked',
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
        ref: z.string().describe('observe_page 返回的输入框 ref（如 "e2"）'),
        value: z.string().describe('要填写的文本'),
      }),
      async (args) => {
        const taskMeta = meta();
        const r = await runCommand('fill', { ref: args.ref, value: args.value }, () => undefined);
        if (!r.ok) {
          emitAction(taskMeta, 'fill', { url: currentUrl(), detail: args.ref, result: 'error' });
          return isErrorResult(`填写失败：${r.message}`);
        }
        emitAction(taskMeta, 'fill', { url: currentUrl(), detail: args.ref, result: 'filled' });
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
        '文本超过 8000 字符时截断并提示，可用 observe_page 定位子元素分次读取。',
      z.object({
        ref: z.string().optional().describe('要读取的元素 ref；不传则读正文容器'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction(taskMeta, 'read_text', { url: currentUrl(), detail: args.ref || 'main' });
        const r = await runCommand('read_text', { ref: args.ref }, (data) => (data ?? {}) as ReadTextPayload);
        if (!r.ok) return isErrorResult(`读取失败：${r.message}`);
        const text = r.value.text ?? '';
        const totalLength = typeof r.value.totalLength === 'number' ? r.value.totalLength : text.length;
        const truncated =
          totalLength > READ_MAX_CHARS
            ? `\n\n（已截断：原文共 ${totalLength} 字符，显示前 ${READ_MAX_CHARS}；可用 observe_page 定位子元素分次读取）`
            : '';
        return textResult(`${text}${truncated}`);
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-extension',
  label: '浏览器扩展',
  create: createExtensionToolDefs,
  placeholder: [{}],
});
