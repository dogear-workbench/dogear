/**
 * 页面写入与等待工具：click / fill / scroll / wait_for
 *
 * 从 extension-tools 拆出。闭包前置（meta/acquireGate/wallGate 等）经 ExtensionToolContext 注入；
 * click 的提交确认链路辅助（submitLogger/SUBMIT_CONFIRM_TIMEOUT_MS/submitTargetOf/formatClick）与
 * wait_for 的通道超时缓冲（WAIT_FOR_CHANNEL_BUFFER_MS）为对应工具独用，随工具落在本文件。
 */

import { z } from 'zod';
import { getExtensionStatus } from '../../services/browser/browser-gateway.js';
import { isPaymentBlocked, paymentBlockedMessage, policyGate } from '../../services/browser/site-policy.js';
import { raiseHumanIntervention, waitForInterventionResult } from '../../services/browser/human-intervention.js';
import { mainLogger } from '../../agents/logger.js';
import {
  currentUrl,
  emitAction,
  isErrorResult,
  markActionDone,
  paceActionGate,
  runCommand,
  textResult,
} from './extension-command-shared.js';
import { pageStateSuffix, type ClickPayload, type ScrollPayload, type WaitForPayload } from './extension-observe-format.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { reasonOf, type ExtensionToolContext } from './extension-tool-context.js';

const submitLogger = mainLogger.child('extension-submit');

const SUBMIT_CONFIRM_TIMEOUT_MS = 5 * 60_000;
/** wait_for 注入侧还要加导航检测缓冲，通道超时预留 10s 才不会被 gateway 先行判死 */
const WAIT_FOR_CHANNEL_BUFFER_MS = 10_000;

function submitTargetOf(data: unknown): string {
  const target = (data as { submitTarget?: unknown } | null | undefined)?.submitTarget;
  return typeof target === 'string' && target ? target : '提交操作';
}

function formatClick(ref: string, data: ClickPayload): string {
  if (data.verification === 'lost') {
    return `已点击 ${ref} 并触发导航，当前页面: ${data.urlAfter ?? '未知'}（点击结果验证数据已丢失）。旧元素引用已失效，操作新页面请重新 observe_page。`;
  }
  if (data.openedTab) {
    const tab = data.openedTab;
    const titleNote = tab.title ? `「${tab.title}」` : '';
    const urlNote = tab.url ? `（${tab.url}）` : '';
    const hiddenNote = data.targetHidden
      ? '\n⚠ 目标是隐藏元素，点击结果可能无效，建议改用可见元素重试（find 结果带 [隐藏] 标注，对应 visible 字段）'
      : '';
    return (
      `已点击 ${ref}，已在新标签页打开${titleNote}${urlNote}（tabId ${tab.tabId ?? '未知'}），焦点已切至新标签页。${hiddenNote}\n` +
      `后续 observe_page / click / fill 等页面操作将作用于新标签页，请先 observe_page 获取新页面元素。`
    );
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
  if (data.targetHidden) {
    changes.push('⚠ 目标是隐藏元素，点击结果可能无效，建议改用可见元素重试（find 结果带 [隐藏] 标注，对应 visible 字段）');
  }
  if (changes.length === 0) changes.push('页面无明显变化（可能为无效果点击）');
  return `已点击 ${ref}。验证：${changes.join('；')}`;
}

export function createActToolDefs(ctx: ExtensionToolContext): ToolDef[] {
  const { conversationId, meta, acquireGate, wallGate, scopeNote } = ctx;
  return [
    defineTool(
      'dogear__extension__click',
      '点击用户浏览器页面元素',
      `${scopeNote}\n` +
        '点击 observe_page 返回的 ref 对应元素，点击后自动附带轻量验证（URL 变化 / 元素消失 / 正文字数变化）；' +
        '点击打开新标签页时自动把操作焦点切至新标签页并回报。' +
        '提交类按钮会被拦截并弹出确认卡，等待用户确认后自动执行；用户拒绝或超时则返回未执行。',
      z.object({
        ref: z.string().describe('observe_page 返回的元素 ref（如 "e3@2"）'),
      }),
      async (args) => {
        const busy = acquireGate('click', args.ref, currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        if (pageUrl && isPaymentBlocked(pageUrl)) {
          emitAction(taskMeta, 'click', { url: pageUrl, detail: args.ref, result: 'risk_blocked' });
          return isErrorResult(paymentBlockedMessage());
        }
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'click', { url: pageUrl, detail: args.ref, result: 'risk_blocked' });
          return isErrorResult(gate.blocked);
        }
        await paceActionGate(conversationId);
        const executeClick = (confirmed: boolean) =>
          runCommand('click', confirmed ? { ref: args.ref, confirmed: true } : { ref: args.ref }, (data) => (data ?? {}) as ClickPayload);
        const startedAt = Date.now();
        const r = await executeClick(false);
        markActionDone(conversationId);
        if (!r.ok) {
          if (r.errorCode === 'guard_submit') {
            const status = getExtensionStatus();
            const request = await raiseHumanIntervention({
              tabId: `ext-${status.status === 'connected' ? status.tabId : 'unknown'}`,
              reason: 'guard_submit',
              message: `agent 请求提交：「${submitTargetOf(r.data)}」${pageUrl ? `（${pageUrl}）` : ''}`,
              url: pageUrl,
              taskMeta,
              confirmMode: true,
              conversationId,
              actions: [
                { key: 'approved', label: '确认执行', tone: 'primary' },
                { key: 'denied', label: '拒绝', tone: 'destructive' },
              ],
            });
            const { outcome } = await waitForInterventionResult(request.id, SUBMIT_CONFIRM_TIMEOUT_MS);
            // WARN 级别才会落盘；提交确认链路需事后可审计
            submitLogger.warn(`提交确认结果: outcome=${outcome} ref=${args.ref} url=${pageUrl ?? ''}`);
            if (outcome === 'unattended') {
              emitAction(taskMeta, 'click', { url: pageUrl, detail: args.ref, result: 'error', errorCode: 'guard_submit' });
              return isErrorResult('用户不在（无人值守），提交确认无法完成，本次提交未执行；请改用其他路径（换源/降级/跳过并在收尾报告注明）');
            }
            if (outcome === 'denied') {
              emitAction(taskMeta, 'click', { url: pageUrl, detail: args.ref, result: 'error', errorCode: 'guard_submit' });
              return isErrorResult('用户已拒绝本次提交，未执行。请引导用户手动完成提交或调整方案');
            }
            if (outcome === 'manual') {
              emitAction(taskMeta, 'click', { url: pageUrl, detail: args.ref, result: 'manual_submitted' });
              return textResult('用户已在浏览器手动完成提交。请重新 observe_page 确认当前页面状态后继续任务');
            }
            if (outcome === 'timeout') {
              emitAction(taskMeta, 'click', { url: pageUrl, detail: args.ref, result: 'error', errorCode: 'guard_submit' });
              return isErrorResult('等待用户确认超时（5 分钟），提交未执行。可重新触发或引导用户手动提交');
            }
            if (outcome !== 'approved') {
              emitAction(taskMeta, 'click', { url: pageUrl, detail: args.ref, result: 'error', errorCode: 'guard_submit' });
              return isErrorResult('等待确认期间页面状态已变化，提交未执行。请重新 observe_page 确认页面后再试');
            }
            const r2 = await executeClick(true);
            markActionDone(conversationId);
            submitLogger.warn(`确认后提交执行: ok=${r2.ok} errorCode=${r2.ok ? '-' : r2.errorCode ?? '-'} ref=${args.ref}`);
            if (!r2.ok) {
              emitAction(taskMeta, 'click', {
                url: pageUrl,
                detail: args.ref,
                result: 'error',
                errorCode: r2.errorCode,
                durationMs: Date.now() - startedAt,
              });
              return isErrorResult(`用户已确认提交，但执行失败：${r2.message}`);
            }
            emitAction(taskMeta, 'click', {
              url: r2.value.openedTab?.url ?? r2.value.urlAfter ?? pageUrl,
              detail: `${args.ref}（用户已确认提交）`,
              result: 'clicked',
              urlBefore: r2.value.urlBefore,
              ...(r2.value.urlAfter ? { urlAfter: r2.value.urlAfter } : {}),
              durationMs: Date.now() - startedAt,
            });
            return textResult(`用户已确认提交。${formatClick(args.ref, r2.value)}`);
          }
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
          url: r.value.openedTab?.url ?? r.value.urlAfter ?? pageUrl,
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
      `${scopeNote}\n` +
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
        await paceActionGate(conversationId);
        const startedAt = Date.now();
        const r = await runCommand('fill', { ref: args.ref, value: args.value }, () => undefined);
        markActionDone(conversationId);
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
            `提交类点击需用户在确认卡上确认后才会执行。`,
        );
      },
    ),

    defineTool(
      'dogear__extension__scroll',
      '滚动用户浏览器页面或容器',
      `${scopeNote}\n` +
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

    defineTool(
      'dogear__extension__wait_for',
      '等待用户浏览器页面条件满足',
      `${scopeNote}\n` +
        '在超时时间内每 400ms 轮询等待页面满足条件：元素出现（visible）、元素消失（hidden）或文本出现' +
        '（text_contains，无 selector/ref 时查整页正文，有限定则查该容器）。适用于点击后的跳转/异步加载等待。' +
        '等待期间页面导航会终止等待并要求重新 observe_page；visible 条件下 ref 对应元素从页面消失时立即报错（标记不会重新出现）。',
      z.object({
        selector: z.string().optional().describe('CSS 选择器（如 "#result" ".loading"）'),
        ref: z.string().optional().describe('observe_page 返回的元素 ref（如 "e3@2"）'),
        condition: z
          .enum(['visible', 'hidden', 'text_contains'])
          .describe('等待条件：visible 元素出现 / hidden 元素消失 / text_contains 文本包含'),
        text: z.string().optional().describe('condition=text_contains 时要等待出现的文本子串'),
        timeoutMs: z.number().int().min(1000).max(30000).describe('超时毫秒数（1000-30000）'),
      }),
      async (args) => {
        if ((args.condition === 'visible' || args.condition === 'hidden') && !args.selector && !args.ref) {
          return isErrorResult('visible/hidden 条件需要 selector 或 ref 定位元素');
        }
        if (args.condition === 'text_contains' && (!args.text || args.text.length === 0)) {
          return isErrorResult('text_contains 条件需要提供 text（要等待出现的文本子串）');
        }
        const detail = [args.condition, args.selector ?? args.ref ?? '', args.text ?? ''].filter(Boolean).join(' ');
        const busy = acquireGate('wait_for', detail, currentUrl());
        if (busy) return busy;
        const taskMeta = meta();
        const pageUrl = currentUrl();
        const gate = await policyGate(conversationId, pageUrl ?? '');
        if ('blocked' in gate) {
          emitAction(taskMeta, 'wait_for', { url: pageUrl, detail, result: 'risk_blocked' });
          return isErrorResult(gate.blocked);
        }
        const startedAt = Date.now();
        const r = await runCommand(
          'wait_for',
          { selector: args.selector, ref: args.ref, condition: args.condition, text: args.text, timeoutMs: args.timeoutMs },
          (data) => (data ?? {}) as WaitForPayload,
          args.timeoutMs + WAIT_FOR_CHANNEL_BUFFER_MS,
        );
        if (!r.ok) {
          emitAction(taskMeta, 'wait_for', {
            url: pageUrl,
            detail,
            result: 'error',
            errorCode: r.errorCode,
            durationMs: Date.now() - startedAt,
          });
          if (r.errorCode === 'value_mismatch') {
            return isErrorResult(reasonOf(r.data) ?? r.message);
          }
          if (r.errorCode === 'timeout') {
            return isErrorResult(
              `等待未能在扩展侧完成（${args.timeoutMs}ms 等待加注入开销超出通道上限），请缩短 timeoutMs 或拆分多次等待`,
            );
          }
          return isErrorResult(`等待失败：${r.message}`);
        }
        const w = r.value;
        if (!w.matched) {
          const wall = await wallGate(
            w.pageState,
            w.url ?? pageUrl,
            w.tabId,
            '请重新执行 wait_for 判断条件是否满足，或先 observe_page 获取页面元素',
          );
          if (wall) return wall;
          const target =
            args.condition === 'text_contains'
              ? `文本 "${args.text}" 未出现`
              : args.condition === 'visible'
                ? '元素未出现'
                : '元素未消失';
          emitAction(taskMeta, 'wait_for', {
            url: w.url ?? pageUrl,
            detail,
            result: 'timeout',
            durationMs: Date.now() - startedAt,
          });
          return isErrorResult(
            `等待超时（${args.timeoutMs}ms）：${target}。当前页面: ${w.url ?? pageUrl ?? ''}${pageStateSuffix(w.pageState)}`,
          );
        }
        emitAction(taskMeta, 'wait_for', {
          url: w.url ?? pageUrl,
          detail,
          result: 'matched',
          durationMs: Date.now() - startedAt,
        });
        return textResult(`条件已满足。当前页面: ${w.url ?? pageUrl ?? ''}${pageStateSuffix(w.pageState)}`);
      },
    ),
  ];
}
