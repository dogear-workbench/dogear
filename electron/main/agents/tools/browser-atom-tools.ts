/**
 * 内嵌浏览器观察类原子工具：navigate / observe_page / find / read_text / wait_for / screenshot
 *
 * 观察入口挂 site-policy gate 并对返回文本做风控关键词扫描（规则与扩展通道一致）。
 * navigate 返回统一 pageState（URL 模式 + 页面特征关键词集中判定），非常规状态附下一步引导。
 */

import { z } from 'zod';
import {
  findInTab,
  observeTab,
  readTabText,
  READ_MAX_CHARS,
} from '../../services/browser/embedded/ax-observe.js';
import { pageStateHint, resolvePageState } from '../../services/browser/embedded/page-state.js';
import { navigateTab } from '../../services/browser/embedded/navigate.js';
import { waitForTabCondition } from '../../services/browser/embedded/wait-for.js';
import { getEmbeddedBrowserManager } from '../../services/browser/embedded/embedded-browser-manager.js';
import {
  raiseHumanIntervention,
  resolveInterventionsForTab,
} from '../../services/browser/human-intervention.js';
import {
  checkNoteBudget,
  consumeNote,
  controlledBrowserBlock,
  navigateGate,
  consumeSearch,
  policyGate,
  riskSignalMessage,
  scanAndMarkRisk,
  type PolicyGateContext,
} from '../../services/browser/site-policy.js';
import {
  buildTaskMeta,
  createAgentTabRunner,
  emitAction,
  formatEmbeddedObserve,
  formatObserveElement,
  isErrorResult,
  textResult,
  USER_TAKEOVER_BLOCK_MESSAGE,
} from './browser-tool-shared.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import type { ObservePayload, FindPayload } from '../../services/browser/embedded/ax-tree.js';
import type { ReadTextResult } from '../../services/browser/embedded/ax-observe.js';

const SCREENSHOT_TIMEOUT_MS = 10_000;

export function createBrowserObserveToolDefs(opts?: {
  conversationId?: string;
  workspaceId?: string;
  workspacePath?: string;
}): ToolDef[] {
  const conversationId = opts?.conversationId;
  const embeddedWorkspaceId = opts?.workspaceId;
  const embeddedHolderId = conversationId ?? 'browser-tools';
  const meta = () => buildTaskMeta(conversationId);
  const withAgentTab = createAgentTabRunner(embeddedWorkspaceId, embeddedHolderId);

  return [
    defineTool(
      'dogear__browser__navigate',
      '浏览器导航到 URL',
      '让内嵌浏览器导航到指定 URL，等待加载就绪后返回最终 URL、标题、正文字数与页面状态（含登录墙/人机验证/限流判定）。' +
        '仅用于 readArticle 失败后的手动探索流程；单纯读文章请用 dogear__browser__readArticle。' +
        '小红书等登录态站点禁止本通道，请用 dogear__extension__* 扩展通道。受节奏保护的站点导航前会自动等待随机时长。',
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
        const currentAgentTabId = getEmbeddedBrowserManager().getAgentTabId(embeddedWorkspaceId);
        if (currentAgentTabId && getEmbeddedBrowserManager().isTabTakenOver(currentAgentTabId)) {
          emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: args.url, result: 'user_takeover' });
          return isErrorResult(USER_TAKEOVER_BLOCK_MESSAGE);
        }
        const gate = await navigateGate(conversationId, args.url);
        if ('blocked' in gate) {
          emitAction({
            source: 'navigate',
            taskMeta,
            action: 'navigate',
            url: args.url,
            detail: gate.blocked,
            result: gate.reason === 'risk' ? 'risk_blocked' : 'budget_exceeded',
          });
          return isErrorResult(gate.blocked);
        }
        emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: args.url });
        try {
          const { snapshot, record } = await navigateTab(
            getEmbeddedBrowserManager(),
            embeddedWorkspaceId,
            args.url,
            embeddedHolderId,
          );
          if (gate.isSearch) consumeSearch(conversationId);
          const stats = await readTabText(record).catch(() => ({ text: '', totalLength: 0 }));
          if (gate.ctx) {
            const hits = scanAndMarkRisk(conversationId, gate.ctx, stats.text);
            if (hits) {
              emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: snapshot.url, detail: hits.join('、'), result: 'risk_signal' });
              return isErrorResult(riskSignalMessage(hits));
            }
          }
          const pageState = resolvePageState(record, stats.text);
          const hint = pageStateHint(pageState);
          if (pageState === 'login_required' || pageState === 'verification_required') {
            raiseHumanIntervention({
              tabId: record.tabId,
              reason: pageState,
              message: hint ?? '页面需要人工处理后 agent 才能继续',
              url: snapshot.url,
              taskMeta,
            });
          } else {
            resolveInterventionsForTab(record.tabId);
          }
          emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: snapshot.url, result: 'ok' });
          return textResult(
            `已导航到: ${snapshot.url}\ntabId: ${snapshot.tabId}\n标题: ${snapshot.title}\n正文字数: ${stats.totalLength}\n状态: ${pageState}（generation ${snapshot.generation}）` +
              (hint ? `\n⚠️ ${hint}` : '') +
              `\n需要操作页面元素时，先调用 dogear__browser__observe_page 获取 ref 列表。`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitAction({ source: 'navigate', taskMeta, action: 'navigate', url: args.url, detail: message, result: 'error' });
          return isErrorResult(`导航失败：${message}`);
        }
      },
    ),

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
        const detail = args.text_filter || args.region || '';
        emitAction({ source: 'observe_page', taskMeta, action: 'observe', detail });
        const r = await withAgentTab(
          async (tab): Promise<{ blocked: string } | { payload: ObservePayload; gateCtx: PolicyGateContext | null }> => {
            const gate = await policyGate(conversationId, tab.url);
            if ('blocked' in gate) return { blocked: gate.blocked };
            try {
              getEmbeddedBrowserManager().ensureInputReady(tab.tabId);
            } catch {
              // 无宿主窗口时跳过屏外挂载：不可见 tab 的 AX 树与 DOM 兜底可见性会降级，但不阻塞观察
            }
            return { payload: await observeTab(tab, { region: args.region, textFilter: args.text_filter }), gateCtx: gate.ctx };
          },
        );
        if (!r.ok) return isErrorResult(`观察页面失败：${r.message}`);
        if ('blocked' in r.value) return isErrorResult(r.value.blocked);
        const text = formatEmbeddedObserve(r.value.payload);
        if (r.value.gateCtx) {
          const hits = scanAndMarkRisk(conversationId, r.value.gateCtx, text);
          if (hits) {
            emitAction({ source: 'observe_page', taskMeta, action: 'observe', detail, result: 'risk_signal' });
            return isErrorResult(riskSignalMessage(hits));
          }
        }
        return textResult(text);
      },
    ),

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
        const r = await withAgentTab(
          async (tab): Promise<{ blocked: string } | { payload: FindPayload; gateCtx: PolicyGateContext | null }> => {
            const gate = await policyGate(conversationId, tab.url);
            if ('blocked' in gate) return { blocked: gate.blocked };
            return {
              payload: await findInTab(tab, { role: args.role, name: args.name, exact: args.exact, maxResults: args.max_results }),
              gateCtx: gate.ctx,
            };
          },
        );
        if (!r.ok) return isErrorResult(`查找失败：${r.message}`);
        if ('blocked' in r.value) return isErrorResult(r.value.blocked);
        const { payload, gateCtx } = r.value;
        if (payload.elements.length === 0) {
          return textResult(
            `未找到匹配元素（role=${args.role ?? '任意'}，name="${args.name ?? '任意'}"${args.exact ? '，精确匹配' : ''}）。\n` +
              `当前页面: ${payload.url}（${payload.pageState}）。可放宽匹配条件、换近义词，或用 observe_page 查看页面全貌。`,
          );
        }
        const text = payload.elements.map(formatObserveElement).join('\n');
        if (gateCtx) {
          const hits = scanAndMarkRisk(conversationId, gateCtx, text);
          if (hits) {
            emitAction({ source: 'find', taskMeta, action: 'observe', detail, result: 'risk_signal' });
            return isErrorResult(riskSignalMessage(hits));
          }
        }
        return textResult(
          `找到 ${payload.elements.length} 个匹配元素（页面 ${payload.url}，${payload.pageState}，generation ${payload.generation}）：\n` +
            `${text}\n\nref 可直接用于 click/fill/scroll/read_text/find；页面导航或路由变化后需重新查找。`,
        );
      },
    ),

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
        const detail = args.ref || 'main';
        emitAction({ source: 'read_text', taskMeta, action: 'read_text', detail });
        const r = await withAgentTab(
          async (
            tab,
          ): Promise<{ blocked: string } | { result: ReadTextResult; gateCtx: PolicyGateContext | null; countAsNote: boolean }> => {
            const gate = await policyGate(conversationId, tab.url);
            if ('blocked' in gate) return { blocked: gate.blocked };
            const countAsNote = gate.ctx !== null && !args.ref;
            if (countAsNote && gate.ctx) {
              const budgetMessage = checkNoteBudget(conversationId, gate.ctx.policy);
              if (budgetMessage) return { blocked: budgetMessage };
            }
            return { result: await readTabText(tab, args.ref), gateCtx: gate.ctx, countAsNote };
          },
        );
        if (!r.ok) return isErrorResult(`读取失败：${r.message}`);
        if ('blocked' in r.value) return isErrorResult(r.value.blocked);
        const { result, gateCtx, countAsNote } = r.value;
        if (gateCtx) {
          const hits = scanAndMarkRisk(conversationId, gateCtx, result.text);
          if (hits) {
            emitAction({ source: 'read_text', taskMeta, action: 'read_text', detail, result: 'risk_signal' });
            return isErrorResult(riskSignalMessage(hits));
          }
        }
        if (gateCtx && countAsNote) consumeNote(conversationId);
        const truncated =
          result.totalLength > READ_MAX_CHARS
            ? `\n\n（已截断：原文共 ${result.totalLength} 字符，显示前 ${READ_MAX_CHARS}；可用 observe_page/find 重新定位子元素后分次读取）`
            : '';
        return textResult(`${result.text}${truncated}`);
      },
    ),

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
        const r = await withAgentTab(async (tab) => {
          const wait = await waitForTabCondition(tab, { text: args.text, urlContains: args.url_contains, timeoutSec: args.timeout });
          if (wait.matched) resolveInterventionsForTab(tab.tabId);
          return { wait, state: resolvePageState(tab) };
        }, 'write');
        if (!r.ok) return isErrorResult(`等待失败：${r.message}`);
        if (!r.value.wait.matched) {
          const conditions = [
            args.url_contains ? `URL 未包含 "${args.url_contains}"` : '',
            args.text ? `页面文本未包含 "${args.text}"` : '',
          ]
            .filter(Boolean)
            .join('，');
          const state = r.value.state;
          const stateNote = state !== 'ready' ? `（当前状态: ${state}${pageStateHint(state) ? `——${pageStateHint(state)}` : ''}）` : '';
          return isErrorResult(`等待超时（${args.timeout}s）：${conditions}。当前 URL: ${r.value.wait.url}${stateNote}`);
        }
        return textResult(`条件已满足。当前 URL: ${r.value.wait.url}`);
      },
    ),

  ];
}
