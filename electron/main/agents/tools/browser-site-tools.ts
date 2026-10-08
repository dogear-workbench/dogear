/**
 * 内嵌浏览器通道站点档案工具：dogear__browser__site_knowledge / site_finding
 *
 * 复用 extension-site-tools 的 createSiteToolDefs，存储同一份 site-knowledge-service；
 * 通道差异经 deps 注入：currentUrl 取内嵌 agent tab，无扩展独占 gate（no-op），scopeNote
 * 换内嵌表述并注明与扩展通道共用档案。currentUrl 可注入覆盖（单测隔离内嵌宿主）。
 */

import { getEmbeddedBrowserManager } from '../../services/browser/embedded/embedded-browser-manager.js';
import { isErrorResult, textResult } from './browser-tool-shared.js';
import { createSiteToolDefs } from './extension-site-tools.js';
import type { ToolDef } from '../pi/tool-adapter.js';

const SCOPE_NOTE = '内嵌浏览器通道；本组工具只读写本地站点档案，不碰页面，存储与扩展通道共用同一份档案。';

export function createBrowserSiteToolDefs(opts?: {
  conversationId?: string;
  workspaceId?: string;
  currentUrl?: () => string | undefined;
}): ToolDef[] {
  const currentUrl =
    opts?.currentUrl ??
    (() => {
      if (!opts?.workspaceId) return undefined;
      const manager = getEmbeddedBrowserManager();
      const tabId = manager.getAgentTabId(opts.workspaceId);
      return tabId ? (manager.getTabRecord(tabId)?.url ?? undefined) : undefined;
    });
  return createSiteToolDefs({
    conversationId: opts?.conversationId,
    acquireGate: () => null,
    currentUrl,
    isErrorResult,
    textResult,
    scopeNote: SCOPE_NOTE,
    toolPrefix: 'dogear__browser',
  });
}
