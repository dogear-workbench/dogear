/**
 * 内嵌浏览器操作类工具：click / fill / scroll / read_state
 *
 * 全部走 embedded 协议层原语；入口统一挂 site-policy gate（节奏预算、随机延迟、风控信号，规则与扩展通道一致）。
 * ref = backendNodeId@generation；ref 失效返回明确引导，不做静默重试。
 * 密码类填写与提交类点击被 guard 拦截（guard_password / guard_submit）。
 */

import { z } from 'zod';
import { ActionGuardError, clickTab, fillTab, type ClickResult, type FillResult } from '../../services/browser/embedded/actions.js';
import type { ScrollResult } from '../../services/browser/embedded/scroll.js';
import type { ReadStateResult } from '../../services/browser/embedded/read-state.js';
import type { PolicyGateContext } from '../../services/browser/site-policy.js';
import { readTabState } from '../../services/browser/embedded/read-state.js';
import { scrollTab } from '../../services/browser/embedded/scroll.js';
import { pageStateHint } from '../../services/browser/embedded/page-state.js';
import { raiseHumanIntervention } from '../../services/browser/human-intervention.js';
import type { BrowserTaskMeta } from '../../services/browser/browser-task-meta.js';
import type { EmbeddedTabRecord } from '../../services/browser/embedded/types.js';
import {
  checkNoteBudget,
  consumeNote,
  policyGate,
  scanAndMarkRisk,
  riskSignalMessage,
} from '../../services/browser/site-policy.js';
import {
  buildTaskMeta,
  createAgentTabRunner,
  emitAction,
  isErrorResult,
  textResult,
} from './browser-tool-shared.js';
import { defineTool, type ToolDef, type ToolResult } from '../pi/tool-adapter.js';
import type { EmbeddedPageState } from '../../services/browser/embedded/types.js';

/** read_state 笔记预算按页面 URL 计数（同页多 path 探索不重复计），与扩展通道语义一致 */
const readStateCountedUrlByConv = new Map<string, string>();

function appendPageStateHint(text: string, pageState: EmbeddedPageState): string {
  const hint = pageStateHint(pageState);
  return hint ? `${text}\n⚠️ 状态: ${pageState}——${hint}` : `${text}\n状态: ${pageState}`;
}

/** guard 拦截不是失败：产生「等待人工」卡片，用户在面板完成后点「完成后继续」agent 再继续 */
async function runWithGuardRaise<T>(
  tab: EmbeddedTabRecord,
  taskMeta: BrowserTaskMeta,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ActionGuardError) {
      raiseHumanIntervention({
        tabId: tab.tabId,
        reason: err.code,
        message: err.message,
        url: tab.url,
        taskMeta,
      });
    }
    throw err;
  }
}

function formatClickResult(result: ClickResult): string {
  const methodLabel = result.method === 'keyboard' ? '真实输入' : '合成点击（页面可能通过 isTrusted 识别自动化）';
  if (result.navigated) {
    return appendPageStateHint(
      `已点击 ${result.ref}（${methodLabel}），已触发导航：${result.urlBefore} → ${result.urlAfter || '（加载中）'}。\n` +
        '旧元素引用已失效，操作新页面请先重新 dogear__browser__observe_page。',
      result.pageState,
    );
  }
  const changes: string[] = [];
  if (result.method === 'synthetic') changes.push('本次为合成点击（当前环境真实输入通道不可用，页面可能通过 isTrusted 识别自动化）');
  if (result.elementGone) changes.push('目标元素已从页面消失');
  if (changes.length === 0) changes.push('页面无明显变化（可能为无效果点击）');
  return appendPageStateHint(`已点击 ${result.ref}。验证：${changes.join('；')}。`, result.pageState);
}

function formatFillResult(result: FillResult): string {
  const base = result.verified
    ? `已向 ${result.ref} 填写文本，值已生效。`
    : `已向 ${result.ref} 填写文本，但回读校验不一致（页面可能改写了内容），请用 read_text 确认实际值。`;
  return appendPageStateHint(base, result.pageState);
}

export function createBrowserActionToolDefs(opts?: {
  conversationId?: string;
  workspaceId?: string;
}): ToolDef[] {
  const conversationId = opts?.conversationId;
  const embeddedWorkspaceId = opts?.workspaceId;
  const embeddedHolderId = conversationId ?? 'browser-tools';
  const meta = () => buildTaskMeta(conversationId);
  const withAgentTab = createAgentTabRunner(embeddedWorkspaceId, embeddedHolderId);

  /** 操作入口统一 gate：命中站点策略时先风控拒绝检查再随机延迟（规则与扩展通道一致，不放松） */
  async function actionGate(tabUrl: string): Promise<string | null> {
    const gate = await policyGate(conversationId, tabUrl);
    if ('blocked' in gate) return gate.blocked;
    return null;
  }

  return [
    defineTool(
      'dogear__browser__click',
      '点击页面元素',
      '点击 observe_page 返回的 ref 对应元素（ref 格式 节点id@generation），点击后附带轻量验证（是否触发导航 / 元素是否消失）。' +
        'ref 失效会返回明确错误，需重新 observe_page。提交类按钮会被拦截（guard_submit），需引导用户手动提交。需要用户确认后执行。',
      z.object({
        ref: z.string().describe('observe_page 返回的元素 ref（如 "123@5"）'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction({ source: 'click', taskMeta, action: 'click', detail: args.ref });
        const r = await withAgentTab(async (tab): Promise<{ blocked: string } | { result: ClickResult }> => {
          const blocked = await actionGate(tab.url);
          if (blocked) return { blocked };
          return { result: await runWithGuardRaise(tab, taskMeta, () => clickTab(tab, args.ref)) };
        }, 'write');
        if (!r.ok) {
          const guard = r.error instanceof ActionGuardError;
          emitAction({
            source: 'click',
            taskMeta,
            action: 'click',
            detail: guard ? args.ref : r.message,
            result: guard ? 'guard_blocked' : 'error',
          });
          return isErrorResult(guard ? r.message : `点击失败：${r.message}`);
        }
        if ('blocked' in r.value) return isErrorResult(r.value.blocked);
        emitAction({ source: 'click', taskMeta, action: 'click', detail: args.ref, result: 'clicked' });
        return textResult(formatClickResult(r.value.result));
      },
    ),

    defineTool(
      'dogear__browser__fill',
      '填写页面输入框',
      '向 observe_page 返回的 ref 对应输入框填写文本（ref 格式 节点id@generation；会先全选清空原内容），填写后自动验证值是否生效。' +
        '密码类输入会被拦截（guard_password），需引导用户手动填写。需要用户确认后执行。',
      z.object({
        ref: z.string().describe('observe_page 返回的输入框 ref（如 "45@6"）'),
        value: z.string().describe('要填写的文本'),
      }),
      async (args) => {
        const taskMeta = meta();
        emitAction({ source: 'fill', taskMeta, action: 'fill', detail: args.ref });
        const r = await withAgentTab(async (tab): Promise<{ blocked: string } | { result: FillResult }> => {
          const blocked = await actionGate(tab.url);
          if (blocked) return { blocked };
          return { result: await runWithGuardRaise(tab, taskMeta, () => fillTab(tab, args.ref, args.value)) };
        }, 'write');
        if (!r.ok) {
          const guard = r.error instanceof ActionGuardError;
          emitAction({
            source: 'fill',
            taskMeta,
            action: 'fill',
            detail: guard ? args.ref : r.message,
            result: guard ? 'guard_blocked' : 'error',
          });
          return isErrorResult(guard ? r.message : `填写失败：${r.message}`);
        }
        if ('blocked' in r.value) return isErrorResult(r.value.blocked);
        emitAction({ source: 'fill', taskMeta, action: 'fill', detail: args.ref, result: 'filled' });
        return textResult(formatFillResult(r.value.result));
      },
    ),

    defineTool(
      'dogear__browser__scroll',
      '滚动页面或容器',
      '滚动内嵌浏览器页面：不传 ref 滚动整个文档；传 ref 滚动该元素容器内部。' +
        'deltaY 相对滚动（像素，正向下/负向上），position="top"|"bottom" 精确滚到顶/底（deltaY 与 position 至少提供一个）。' +
        '返回滚动前后位置（before/after）与是否移动（moved）。',
      z.object({
        ref: z.string().optional().describe('要滚动的容器元素 ref（如 "12@3"）；不传则滚动整个文档'),
        deltaY: z.number().min(-50_000).max(50_000).optional().describe('相对滚动像素（正向下，如 600；负值向上）'),
        position: z.enum(['top', 'bottom']).optional().describe('精确滚动到顶部/底部'),
      }),
      async (args) => {
        const taskMeta = meta();
        const detail = args.ref ?? (args.position ?? String(args.deltaY ?? ''));
        emitAction({ source: 'scroll', taskMeta, action: 'scroll', detail });
        const r = await withAgentTab(async (tab): Promise<{ blocked: string } | { result: ScrollResult }> => {
          const blocked = await actionGate(tab.url);
          if (blocked) return { blocked };
          return {
            result: await scrollTab(tab, { ref: args.ref, deltaY: args.deltaY, position: args.position }),
          };
        }, 'write');
        if (!r.ok) {
          emitAction({ source: 'scroll', taskMeta, action: 'scroll', detail, result: 'error' });
          return isErrorResult(`滚动失败：${r.message}`);
        }
        if ('blocked' in r.value) return isErrorResult(r.value.blocked);
        const s = r.value.result;
        emitAction({ source: 'scroll', taskMeta, action: 'scroll', detail, result: 'ok' });
        const targetLabel = s.target === 'container' ? `容器（${args.ref}）` : '文档';
        const movedNote = s.moved
          ? ''
          : '；未产生滚动（可能已到边界、内容不足一屏或目标不可滚动）';
        return textResult(
          appendPageStateHint(
            `已滚动${targetLabel}：scrollTop ${s.before.top} → ${s.after.top}${movedNote}。` +
              `内容总高 ${s.after.height}px，可视 ${s.after.clientHeight}px。`,
            s.pageState,
          ),
        );
      },
    ),

    defineTool(
      'dogear__browser__read_state',
      '读取页面 SPA 内存状态',
      '读取当前页面 window.__INITIAL_STATE__（小红书/知乎类 SPA 的数据源），双模式：' +
        '不传 path 返回顶层概要（每个 key 的类型/子项数或长度）；传 path（点分路径，纯数字段为数组下标）返回该子树 JSON（超 8000 字符截断）。' +
        '读内存 JSON 零网络请求，适合避开 feed 页重渲染与元素上限；页面无 __INITIAL_STATE__ 时明确报错。',
      z.object({
        path: z
          .string()
          .optional()
          .describe('点分路径（如 "home.feed.0"），纯数字段为数组下标；不传则返回顶层概要'),
      }),
      async (args) => {
        const taskMeta = meta();
        const detail = args.path || '顶层概要';
        emitAction({ source: 'read_state', taskMeta, action: 'read_state', detail });
        const r = await withAgentTab(
          async (
            tab,
          ): Promise<
            | { blocked: string }
            | { state: ReadStateResult; gateCtx: PolicyGateContext | null; pageUrl: string; isNewPageUrl: boolean }
          > => {
            const gate = await policyGate(conversationId, tab.url);
            if ('blocked' in gate) return { blocked: gate.blocked };
            const isNewPageUrl = gate.ctx !== null && readStateCountedUrlByConv.get(conversationId ?? '') !== tab.url;
            if (gate.ctx && isNewPageUrl) {
              const budgetMessage = checkNoteBudget(conversationId, gate.ctx.policy);
              if (budgetMessage) return { blocked: budgetMessage };
            }
            const state = await readTabState(tab, args.path);
            return { state, gateCtx: gate.ctx, pageUrl: tab.url, isNewPageUrl };
          },
        );
        if (!r.ok) {
          emitAction({ source: 'read_state', taskMeta, action: 'read_state', detail, result: 'error' });
          return isErrorResult(`读取失败：${r.message}`);
        }
        if ('blocked' in r.value) return isErrorResult(r.value.blocked);
        const { state, gateCtx, pageUrl, isNewPageUrl } = r.value;
        const failNote = (result: string, message: string): ToolResult => {
          emitAction({ source: 'read_state', taskMeta, action: 'read_state', detail, result });
          return isErrorResult(message);
        };
        if (state.missing) {
          return failNote(
            'missing_state',
            '本页无 __INITIAL_STATE__（非 SPA 页面或框架未挂载数据源），请改用 observe_page / read_text',
          );
        }
        if (state.notFound) {
          const keys = (state.availableKeys ?? []).join('、');
          return failNote(
            'path_not_found',
            `__INITIAL_STATE__ 中不存在路径 "${args.path}"（该层可用 key：${keys || '（无）'}），请修正 path 后重试`,
          );
        }
        if (state.notSerializable) {
          return failNote('not_serializable', '该子树无法 JSON 序列化（可能含循环引用），请换更深的子路径缩小范围后重试');
        }
        const text = state.summary ?? state.json ?? '';
        if (gateCtx) {
          const hits = scanAndMarkRisk(conversationId, gateCtx, text);
          if (hits) {
            emitAction({ source: 'read_state', taskMeta, action: 'read_state', detail, result: 'risk_signal' });
            return isErrorResult(riskSignalMessage(hits));
          }
        }
        if (gateCtx && isNewPageUrl && pageUrl) {
          consumeNote(conversationId);
          readStateCountedUrlByConv.set(conversationId ?? '', pageUrl);
        }
        emitAction({ source: 'read_state', taskMeta, action: 'read_state', detail, result: 'ok' });
        if (state.summary !== undefined) {
          return textResult(
            `页面 __INITIAL_STATE__ 顶层概要：\n${state.summary || '（空对象）'}\n\n传 path（如 "key.subkey.0"）可下钻查看子树，纯数字段为数组下标。`,
          );
        }
        const truncatedNote =
          state.truncated && typeof state.totalLength === 'number'
            ? `\n\n（已截断：原文共 ${state.totalLength} 字符，显示前 8000；可换更深的子路径缩小范围）`
            : '';
        return textResult(`${text}${truncatedNote}`);
      },
    ),
  ];
}
