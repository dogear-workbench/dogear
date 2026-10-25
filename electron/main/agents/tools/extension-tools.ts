/**
 * 浏览器扩展 MCP Server 工具（页面操作组）聚合入口
 *
 * dogear__extension__* 工具组：页面操作 11 工具按域拆在 extension-nav-tools.ts（navigate/readArticle/screenshot）、
 * extension-read-tools.ts（observe_page/find/read_text/read_state）、extension-act-tools.ts（click/fill/scroll/wait_for）
 * + tab 管理 open_tab / close_tab / list_tabs（extension-tab-tools.ts）+ site_knowledge / site_finding / site_policy
 * （extension-site-tools.ts）+ 文章回存（extension-web-tools.ts）。
 * 作用于用户真实浏览器中 Dogear 管理的标签页（agent 专属窗口内 + 用户移交的焦点页面，经 NativeMessaging 通道 sendExtensionCommand），
 * 导航不受域名限制（支付与网银域名禁用）；点击/填充自动执行但拦截提交类操作（扩展侧 guard 硬护栏）。
 * 站点策略命中（如小红书）：操作间随机延迟、单会话搜索/笔记预算、风控信号即停。
 * 共享辅助（错误文案/命令执行/动作流/作用域说明）在 extension-command-shared.ts，闭包前置（meta/emit/gates）在 extension-tool-context.ts。
 */

import type { ToolDef } from '../pi/tool-adapter.js';
import { createSiteToolDefs } from './extension-site-tools.js';
import { createExtensionTabToolDefs } from './extension-tab-tools.js';
import { createExtensionWebToolDefs } from './extension-web-tools.js';
import { currentUrl, isErrorResult, textResult, SHARED_SCOPE_NOTE } from './extension-command-shared.js';
import { createToolContext } from './extension-tool-context.js';
import { createNavToolDefs } from './extension-nav-tools.js';
import { createReadToolDefs } from './extension-read-tools.js';
import { createActToolDefs } from './extension-act-tools.js';
import { registerToolGroup } from './tool-registry.js';

export function createExtensionToolDefs(opts?: { conversationId?: string; workspaceId?: string; workspacePath?: string }): ToolDef[] {
  const conversationId = opts?.conversationId;
  const workspaceId = opts?.workspaceId;
  const workspacePath = opts?.workspacePath;
  const ctx = createToolContext({ conversationId, workspaceId, workspacePath });
  const { emit, acquireGate } = ctx;
  const [navigate, readArticle, screenshot] = createNavToolDefs(ctx);
  const [observePage, find, readText, readState] = createReadToolDefs(ctx);
  const [click, fill, scroll, waitFor] = createActToolDefs(ctx);
  return [
    navigate,
    observePage,
    find,
    click,
    fill,
    readText,
    readState,
    scroll,
    waitFor,
    readArticle,
    screenshot,

    ...createSiteToolDefs({
      conversationId,
      acquireGate,
      currentUrl,
      isErrorResult,
      textResult,
      scopeNote: '扩展通道会话独占；本组工具只读写本地站点档案，不碰页面。',
    }),

    ...createExtensionTabToolDefs({
      conversationId,
      acquireGate,
      isErrorResult,
      textResult,
      emitAction: emit,
      scopeNote: SHARED_SCOPE_NOTE,
    }),

    ...createExtensionWebToolDefs({ conversationId, workspaceId, workspacePath }),
  ];
}

registerToolGroup({
  server: 'dogear-extension',
  label: '浏览器扩展',
  create: createExtensionToolDefs,
  placeholder: [{}],
});
