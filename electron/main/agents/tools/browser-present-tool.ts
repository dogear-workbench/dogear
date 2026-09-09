/**
 * dogear__browser__present：agent → 用户交付工具
 *
 * 把页面挂到伴随面板「页面视图」区前台呈现（页面即产物）。tabId 呈现已有标签页；
 * url 开新 tab 加载后呈现，不占用 agent 当前操作 tab。
 */

import { z } from 'zod';
import { getEmbeddedBrowserManager } from '../../services/browser/embedded/embedded-browser-manager.js';
import { presentTab } from '../../services/browser/embedded/presentation.js';
import { buildTaskMeta, emitAction, isErrorResult, textResult } from './browser-tool-shared.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

export function createPresentToolDef(opts?: {
  conversationId?: string;
  workspaceId?: string;
}): ToolDef {
  const conversationId = opts?.conversationId;
  const meta = () => buildTaskMeta(conversationId);

  return defineTool(
    'dogear__browser__present',
    '把页面呈现到用户的浏览器面板',
    '把页面挂到伴随面板「页面视图」区前台呈现，作为任务交付物给用户直接查看（页面即产物）。' +
      '参数 tabId 或 url 二选一：tabId 呈现已有标签页（如 readArticle/search 失败后保留的页面）；url 打开新页面呈现。' +
      '使用纪律：\n' +
      '- 调研/探索完成后，把最有价值的页面 present 给用户，再在回复里给结论；不要只贴 URL。\n' +
      '- 呈现后告知用户「已在浏览器面板打开」，不要对已交付页面继续自动操作。\n' +
      '- 登录墙/验证页场景优先用本工具把页面递给用户处理，等用户确认后再继续。',
    z.object({
      tabId: z.string().optional().describe('要呈现的内嵌浏览器标签页 id（来自工具返回的 tabId）'),
      url: z.string().url().optional().describe('要打开并呈现的页面完整 URL（含 http/https）'),
    }),
    async (args) => {
      if (!args.tabId && !args.url) {
        return isErrorResult('tabId 与 url 至少提供一个');
      }
      if (args.url && !args.tabId && !opts?.workspaceId) {
        return isErrorResult('当前会话未关联工作区，无法打开新页面；可改传已有 tabId');
      }
      const taskMeta = meta();
      emitAction({ source: 'present', taskMeta, action: 'present', url: args.url, detail: args.tabId });
      const outcome = await presentTab(getEmbeddedBrowserManager(), args.tabId
        ? { tabId: args.tabId }
        : { url: args.url!, workspaceId: opts?.workspaceId!, holderId: conversationId ?? 'browser-present' });
      if (!outcome.ok) {
        emitAction({ source: 'present', taskMeta, action: 'present', url: args.url, detail: outcome.message, result: 'error' });
        return isErrorResult(`呈现失败：${outcome.message}`);
      }
      emitAction({ source: 'present', taskMeta, action: 'present', url: outcome.url, result: outcome.presented ? 'ok' : 'no_panel' });
      return textResult(
        outcome.presented
          ? `已在浏览器面板呈现页面：${outcome.url}\n请告知用户页面已打开（伴随面板「页面视图」区），等待用户查看或操作。`
          : `页面已保留在内嵌浏览器（${outcome.url}），但当前没有打开的浏览器面板可呈现。\n请告知用户打开主窗口右侧「浏览器」面板即可看到该页面。`,
      );
    },
  );
}
