/**
 * 页面读取工具：observe_page / find / read_text / read_state
 *
 * 从 extension-tools 拆出。闭包前置（meta/acquireGate/wallGate 等）经 ExtensionToolContext 注入；
 * read_state 的笔记预算按页面 URL 去重的可变状态（readStateCountedUrlByConv）保持模块级单例落在本文件。
 */

import { z } from 'zod';
import {
  checkNoteBudget,
  consumeNote,
  policyGate,
  riskSignalMessage,
  scanAndMarkRisk,
} from '../../services/browser/site-policy.js';
import { injectionWarningPrefix, INJECTION_SCAN_NOTE, scanInjection } from '../../services/browser/injection-scan.js';
import { currentUrl, emitAction, isErrorResult, runCommand, textResult } from './extension-command-shared.js';
import {
  formatObserve,
  formatObserveElement,
  parseFindPayload,
  parseObservePayload,
  type ReadStatePayload,
  type ReadTextPayload,
} from './extension-observe-format.js';
import { defineTool, type ToolDef, type ToolResult } from '../pi/tool-adapter.js';
import { policyLogger, type ExtensionToolContext } from './extension-tool-context.js';

const READ_MAX_CHARS = 8_000;

/** read_state 笔记预算按页面 URL 计数（同页多 path 探索不重复计）；与 read_text 的「无 ref 计数」语义互不影响 */
const readStateCountedUrlByConv = new Map<string, string>();

export function createReadToolDefs(ctx: ExtensionToolContext): ToolDef[] {
  const { conversationId, meta, acquireGate, wallGate, scopeNote } = ctx;
  return [
    defineTool(
      'dogear__extension__observe_page',
      '列出用户浏览器页面的可交互元素',
      `${scopeNote}\n` +
        '列出当前已连接标签页中的可交互元素（DOM+ARIA 语义树），每条含 ref 编号、角色、文本与提示信息，链接带 href。' +
        '可交互元素全列不硬截断（超长页有安全阀）；另附标题结构与其余节点的 role 分级摘要。' +
        '可传 region（视口上/中/下分块）或 text_filter 缩小范围重查；超长列表也可用 find 按 role+name 精确查找。' +
        '页面导航后 ref 失效，需重新调用本工具。' +
        INJECTION_SCAN_NOTE,
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
        const wall = await wallGate(
          r.value.pageState,
          r.value.url ?? pageUrl,
          r.value.tabId,
          '请重新调用 observe_page 获取页面元素后继续任务',
        );
        if (wall) return wall;
        emitAction(taskMeta, 'observe', { url: pageUrl, detail, durationMs: Date.now() - startedAt });
        const snapshotText = [
          ...r.value.elements.map((el) => `${el.text ?? ''}\n${el.hint ?? ''}`),
          ...r.value.headings.map((el) => `${el.text ?? ''}\n${el.hint ?? ''}`),
          ...r.value.roleSummary.map((item) => item.sample ?? ''),
        ].join('\n');
        return textResult(`${injectionWarningPrefix(scanInjection(snapshotText))}${text}`);
      },
    ),

    defineTool(
      'dogear__extension__find',
      '按 role+name 在用户浏览器页面中语义查找元素',
      `${scopeNote}\n` +
        '在当前页面的 DOM+ARIA 语义树中按 role（如 link/button/textbox/heading/combobox）与 name（元素文本）重新查找，' +
        '默认子串匹配，exact=true 时精确匹配；不依赖上次 observe_page 的结果，可发现未出现在其输出中的元素。' +
        '至少提供 role 或 name 之一。返回带可直接使用的 ref，并标注可见性（[隐藏] 即 visible=false，对它 click 可能无效，优先选可见元素）。页面导航后需重新查找。',
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
          const emptyWall = await wallGate(
            payload.pageState,
            payload.url ?? pageUrl,
            payload.tabId,
            '请重新调用 find 查找元素，或用 observe_page 查看页面全貌',
          );
          if (emptyWall) return emptyWall;
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
        const wall = await wallGate(
          payload.pageState,
          payload.url ?? pageUrl,
          payload.tabId,
          '请重新调用 find 查找元素后继续任务',
        );
        if (wall) return wall;
        emitAction(taskMeta, 'observe', { url: pageUrl, detail, durationMs: Date.now() - startedAt });
        return textResult(
          `找到 ${payload.elements.length} 个匹配元素（页面 ${payload.url ?? pageUrl ?? ''}，${payload.pageState ?? 'ready'}${payload.generation !== undefined ? `，generation ${payload.generation}` : ''}）：\n` +
            `${text}\n\nref 可直接用于 click/fill/scroll/read_text；页面导航后需重新查找。`,
        );
      },
    ),

    defineTool(
      'dogear__extension__read_text',
      '读取用户浏览器页面元素或正文文本',
      `${scopeNote}\n` +
        '读取指定 ref 元素的纯文本；不传 ref 则读取正文容器（article/main 等中字数最大者）。' +
        '文本超过 8000 字符时截断并提示，可用 observe_page 定位子元素分次读取（带 ref 的分次读取不计笔记预算）。' +
        '受节奏保护的站点（如小红书）无 ref 读取计 1 篇笔记，计入会话笔记预算（超限拒绝）。' +
        INJECTION_SCAN_NOTE,
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
            policyLogger.warn(`read_text 笔记预算拒绝: conv=${conversationId ?? '__adhoc__'} url=${pageUrl ?? ''}`);
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
        const wall = await wallGate(
          r.value.pageState,
          pageUrl,
          r.value.tabId,
          '请重新调用 read_text 读取内容后继续任务',
        );
        if (wall) return wall;
        if (countAsNote) consumeNote(conversationId);
        const totalLength = typeof r.value.totalLength === 'number' ? r.value.totalLength : text.length;
        const truncated =
          totalLength > READ_MAX_CHARS
            ? `\n\n（已截断：原文共 ${totalLength} 字符，显示前 ${READ_MAX_CHARS}；可用 observe_page 定位子元素分次读取）`
            : '';
        emitAction(taskMeta, 'read_text', { url: pageUrl, detail, durationMs: Date.now() - startedAt });
        return textResult(`${injectionWarningPrefix(scanInjection(text))}${text}${truncated}`);
      },
    ),

    defineTool(
      'dogear__extension__read_state',
      '读取用户浏览器页面 SPA 内存状态',
      `${scopeNote}\n` +
        '读取当前页面 window.__INITIAL_STATE__（小红书/知乎类 SPA 的数据源），双模式：' +
        '不传 path 返回顶层概要（每个 key 的类型/子项数或长度）；传 path（点分路径，纯数字段为数组下标）返回该子树 JSON（超 8000 字符截断）。' +
        '读内存 JSON 零网络请求，适合避开 feed 页重渲染与元素上限；页面无 __INITIAL_STATE__ 时明确报错。' +
        '小红书示例：搜索页数据在 __INITIAL_STATE__，先无 path 看顶层概要，再按 key 下钻到卡片数组。' +
        INJECTION_SCAN_NOTE,
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
            policyLogger.warn(`read_state 笔记预算拒绝: conv=${conversationId ?? '__adhoc__'} url=${pageUrl ?? ''}`);
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
        const injectionPrefix = injectionWarningPrefix(scanInjection(text));
        if (v.summary !== undefined) {
          return textResult(
            `${injectionPrefix}页面 __INITIAL_STATE__ 顶层概要：\n${v.summary || '（空对象）'}\n\n传 path（如 "key.subkey.0"）可下钻查看子树，纯数字段为数组下标。`,
          );
        }
        const truncatedNote =
          v.truncated && typeof v.totalLength === 'number'
            ? `\n\n（已截断：原文共 ${v.totalLength} 字符，显示前 8000；可换更深的子路径缩小范围）`
            : '';
        return textResult(`${injectionPrefix}${text}${truncatedNote}`);
      },
    ),
  ];
}
