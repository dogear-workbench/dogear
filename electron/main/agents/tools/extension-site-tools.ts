/**
 * 站点档案工具：dogear__extension__site_knowledge / site_finding
 *
 * 从 extension-tools 拆出。读写本地站点档案（.dogear/site-knowledge/{domain}.md），域名取自
 * 当前扩展通道标签页，无页面交互故不记动作流、不过站点策略（policyGate）；ownership gate 与
 * 其他工具同待遇。isErrorResult / textResult / acquireGate 等经 deps 注入，不在此复制。
 */

import { z } from 'zod';
import type { BrowserActionType } from '../../services/browser/browser-action-stream.js';
import {
  appendSiteFinding,
  hasSiteKnowledge,
  normalizeDomain,
  readSiteKnowledge,
} from '../../services/browser/site-knowledge-service.js';
import { defineTool, type ToolDef, type ToolResult } from '../pi/tool-adapter.js';

export type SiteToolPrefix = 'dogear__extension' | 'dogear__browser';

const NO_URL_MESSAGES: Record<SiteToolPrefix, string> = {
  dogear__extension: '浏览器扩展未连接，无法确定当前站点；请先在扩展弹窗连接目标标签页',
  dogear__browser: '内嵌浏览器暂无活动标签页，请先 dogear__browser__navigate 到目标站点',
};

export interface SiteToolDeps {
  conversationId?: string;
  acquireGate: (action: BrowserActionType | null, detail: string, url?: string) => ToolResult | null;
  currentUrl: () => string | undefined;
  isErrorResult: (message: string) => ToolResult;
  textResult: (text: string) => ToolResult;
  scopeNote: string;
  toolPrefix?: SiteToolPrefix;
}

function domainOrError(
  currentUrl: () => string | undefined,
  isErrorResult: (message: string) => ToolResult,
  noUrlMessage: string,
): { domain: string } | { error: ToolResult } {
  const url = currentUrl();
  if (!url) {
    return { error: isErrorResult(noUrlMessage) };
  }
  const domain = normalizeDomain(url);
  if (!domain) {
    return { error: isErrorResult(`无法从当前页面地址解析域名：${url}`) };
  }
  return { domain };
}

/** navigate 返回尾部指针：有档案引导先读，无档案提示可沉淀（冷启动）；无 url/无域名返回 null */
export function siteKnowledgePointer(
  url: string | undefined,
  toolPrefix: SiteToolPrefix = 'dogear__extension',
): string | null {
  if (!url) return null;
  const domain = normalizeDomain(url);
  if (!domain) return null;
  if (!hasSiteKnowledge(domain)) {
    return `\n\n本站尚无站点档案，探索后可用 ${toolPrefix}__site_finding 沉淀发现`;
  }
  return `\n\n本站有站点档案，建议先调 ${toolPrefix}__site_knowledge 获取已知地图`;
}

export function createSiteToolDefs(deps: SiteToolDeps): ToolDef[] {
  const { conversationId, acquireGate, currentUrl, isErrorResult, textResult, scopeNote } = deps;
  const toolPrefix = deps.toolPrefix ?? 'dogear__extension';
  const findingTool = `${toolPrefix}__site_finding`;
  const exploreNote =
    toolPrefix === 'dogear__browser'
      ? '可自行探索：observe_page 看可交互元素，find 按 role+name 精确查找；'
      : '可自行探索：observe_page 看可交互元素，SPA 页面用 read_state 先看顶层概要再下钻；';
  return [
    defineTool(
      `${toolPrefix}__site_knowledge`,
      '获取当前站点档案（已知地图与探索发现）',
      `${scopeNote}\n` +
        '读取当前标签页所属域名的站点档案：正式地图（已验证的状态路径/直链拼法）+ 探索发现（未验证线索）。' +
        '无档案时正常返回（非错误），可自行探索并用 site_finding 沉淀发现。' +
        'navigate 到新站点后建议先调用本工具，有已知地图就不必盲探。',
      z.object({}),
      async () => {
        const busy = acquireGate(null, 'site_knowledge', currentUrl());
        if (busy) return busy;
        const resolved = domainOrError(currentUrl, isErrorResult, NO_URL_MESSAGES[toolPrefix]);
        if ('error' in resolved) return resolved.error;
        const r = readSiteKnowledge(resolved.domain);
        if (!r.exists) {
          return textResult(
            `本站（${resolved.domain}）暂无站点档案。${exploreNote}` +
              `有价值的新发现（状态路径/直链拼法/页面怪癖）用 ${findingTool} 沉淀到发现区，供后续会话复用。`,
          );
        }
        return textResult(`当前站点 ${resolved.domain} 的站点档案：\n\n${r.content}`);
      },
    ),

    defineTool(
      findingTool,
      '向当前站点档案追加探索发现',
      `${scopeNote}\n` +
        '把探索中发现的新知识（未知状态路径、直链拼法、页面形态怪癖等）追加到当前站点档案的探索发现区，自动带日期与会话标注。' +
        '仅追加发现区；正式地图只能人工/主会话审核后合并，本工具无法写入。' +
        '单条 ≤500 字，60 秒内相同内容自动去重（提示已记录过）。',
      z.object({
        finding: z.string().describe('发现内容（单条 ≤500 字），如状态路径、直链拼法、页面怪癖'),
      }),
      async (args) => {
        const busy = acquireGate(null, 'site_finding', currentUrl());
        if (busy) return busy;
        const resolved = domainOrError(currentUrl, isErrorResult, NO_URL_MESSAGES[toolPrefix]);
        if ('error' in resolved) return resolved.error;
        const r = appendSiteFinding(resolved.domain, args.finding, conversationId ?? '');
        if (!r.ok) return isErrorResult(r.error ?? '写入站点档案失败');
        if (r.deduplicated) return textResult('60 秒内已记录过，未重复写入');
        return textResult('已追加到发现区，待审核合并');
      },
    ),
  ];
}
