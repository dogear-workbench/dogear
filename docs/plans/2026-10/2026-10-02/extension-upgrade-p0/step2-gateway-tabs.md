---
step: 2
title: gateway 多 tab 状态模型
status: done
---

## 目标
gateway 从「单连接单 tab」泛化为「单连接 + Dogear 分组多 tab + 焦点 tab」，命令帧可指定目标 tabId，状态与快照按 tab 维护。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-protocol-tabs.md] 扩展已支持 open_tab/close_tab/list_tabs 命令与 tab_snapshot 多 tab 推送，协议 v4。
- 当前关键文件状态：`electron/main/services/browser/browser-gateway.ts` 的 `ExtensionStatus`（connected 分支）为单值字段 `tabId/title/url/textPreview/generation`；`sendExtensionCommand`（约 :270）从 `currentStatus` 取单 tabId 发帧；`applySnapshot` 已接收 message.tabId 但回退单值；`takeOver` 初始化 `authorizedOrigins: []`。
- 关键决策回顾：焦点 tab 模型见 plan.md；ownership（extension-ownership.ts）是通道级会话独占，天然覆盖多 tab，不改逻辑只改文案（busy 提示语不变）。

## 计划改动
- [ ] `ExtensionStatus` connected 分支：保留现有单值字段语义改为「焦点 tab」（渲染层 `ExtensionStatusLine.tsx` 等零改动），新增 `tabs: Array<{tabId: number; title: string; url: string; generation: number}>`。
- [ ] `takeOver`：初始 `tabs: []`；welcome 后主动发一条 `list_tabs` 命令或约定扩展 hello 后立即推送各受控 tab 快照（选扩展侧推送，gateway 零额外命令）。
- [ ] `applySnapshot`：按 message.tabId 更新 `tabs` 数组对应项；若 tabId === 焦点 tabId 同步更新单值字段；未知 tabId（如 open_tab 新页快照先到）追加进数组。
- [ ] `sendExtensionCommand(kind, params, timeoutMs, opts?: {tabId?: number})`：命令帧 tabId 用 `opts?.tabId ?? currentStatus.tabId`（焦点）。
- [ ] open_tab/close_tab/list_tabs 三命令的 gateway 前置校验：
  - `open_tab`：复用 `validateNavigateTarget(params.targetUrl, authorizedOrigins)`。
  - `close_tab`/`list_tabs`：不做 origin 校验（组内管理动作，扩展侧守组边界）。
  - 现有 `isOriginAuthorized(currentStatus.url, ...)` 的其他命令校验改为按**目标 tab 的 url**校验（焦点 tab 的 url，即 currentStatus.url，行为不变）。
- [ ] close_tab 成功后：从 `tabs` 移除；若关的是焦点，焦点回落到 `tabs` 中最后一项并同步单值字段（无剩余 tab 时状态保留 connected、tabId 置 -1 或空标记，工具层文案提示「分组已空，请 open_tab」）。
- [ ] `COMMAND_ERROR_CODES` 无新增；断连/takeOver 时 `tabs: []` 清空。
- [ ] 验证：连接扩展后（Step 1 已可手动触发命令）确认状态行、快照更新、焦点回落逻辑正确；`DOGEAR_EMBEDDED_BROWSER_SELFTEST` 模式参考——不强制写自测，手动验证即可。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. tab 状态逻辑拆到新文件 `gateway-tab-state.ts`（纯函数：快照 upsert / open 采纳 / close 移除 / list_tabs 对齐），browser-gateway.ts 只做连接编排与状态发布，控制文件膨胀。
  2. close_tab 焦点回落信扩展回包 `focusedTabId`（扩展按 lastAccessed 选，比「tabs 最后一项」准）；仅当回包 focusedTabId 缺失/非法时才兜底空标记。
  3. open_tab 成功回包也做焦点采纳（adoptFocusedTab）：回包必先于快照到达，先切焦点后到快照补全 textPreview/generation，闭环 open_tab 后帧 tabId 与扩展焦点短暂不一致的窗口。
  4. list_tabs 成功回包顺手对齐 tabs 全集（保留 gateway 已知 generation、保留焦点项、gateway 无焦点时采纳回包 focused 项）——修复 tabs 与组内实际集合的漂移。
  5. 扩展侧 background.js welcome 后推送 Dogear 组内各受控 tab 基本快照（title/url/generation，textPreview 空串；焦点 tab 仍由 sendTabSnapshot 推完整快照），实现 takeOver 条目「扩展侧推送，gateway 零额外命令」的定案（Step 1 未实现，本 step 补齐）。
  6. applySnapshot 的 extractError 语义修正：焦点快照无 extractError 时清除旧值（原实现残留），焦点切换时重置。
- 改动文件清单：
  - `electron/main/services/browser/gateway-tab-state.ts`（新）：GatewayTabEntry/GatewayTabFields/NO_FOCUS_TAB_ID(-1) + initialTabFields/applyTabSnapshot/adoptFocusedTab/removeClosedTab/syncTabsFromList 纯函数
  - `electron/main/services/browser/browser-gateway.ts`：ExtensionStatus connected 分支改 `{...} & GatewayTabFields`（单值字段=焦点 tab，新增 tabs）；takeOver 用 initialTabFields（tabs:[]）；applySnapshot 走 applyTabSnapshot；handleCommandResult 按 kind 分派 navigate/open_tab/close_tab/list_tabs 回包处理；sendExtensionCommand 加第 4 参 opts?:{tabId?}（帧 tabId/url 取目标 tab，open_tab 走 validateNavigateTarget，close_tab/list_tabs 免 origin 校验，其余按目标 tab url 校验）
  - `extension/src/tab-commands.js`：导出 getDogearTabs
  - `extension/src/background.js`：welcome 后 pushGroupTabSnapshots()（组内非焦点 tab 各推一条基本快照）
- 验证：`bun run build:electron` 通过；`bun run lint` 0 error（electron/ 在 eslint ignore，全局 warning 均既有）；扩展 JS node --check 通过。真机手测（连接扩展验证状态行/快照/焦点回落）需浏览器环境，留待用户验证。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `ExtensionStatus.connected = { status, extensionVersion, protocolVersion, connectedAt, authorizedOrigins, extractError? } & GatewayTabFields`；`GatewayTabFields = { tabId, title, url, textPreview, generation, tabs: GatewayTabEntry[] }`；`GatewayTabEntry = { tabId, title, url, generation }`；`tabId === -1`（NO_FOCUS_TAB_ID）= 分组已空无焦点。
  - `sendExtensionCommand(kind, params, timeoutMs?, opts?: { tabId?: number })`：帧 tabId/url 取目标 tab（缺省焦点；非焦点目标从 tabs 取 url，未知则空串，扩展侧跳过 navigated_away 检查不误判）。Step 3 的 open_tab/close_tab/list_tabs 工具直接调用即可，close_tab 可传 `params.targetTabId`（透传扩展），指定目标操作时传 opts.tabId。
  - 焦点切换闭环：open_tab/close_tab 回包先到（gateway 立即切焦点），新焦点完整快照后到（补全 textPreview/generation）——工具层无需处理竞态。
  - 组空态：tabId=-1、tabs=[]，普通命令被 permission_denied 拒（文案「目标标签页域名未授权」不贴切），Step 3 工具层应在文案层面区分「分组已空，请 open_tab」（可查 status.tabId === -1）。
- 下个 step 该从哪里继续：Step 3 在 extension-tools.ts 新增 open_tab/close_tab/list_tabs 三工具（gateway 层已就绪，含前置校验与状态同步）；文案按全局决策补「分组已空」分支。
- 待办或已知限制：
  - 扩展重载后真机验证未做（本会话无浏览器环境）：验证点——连接后状态行、open_tab 后焦点切换、close_tab 焦点回落、组空后 open_tab 恢复。
  - gateway tabs 中非焦点 tab 的 textPreview 恒空（快照只推基本字段）；切焦点后由快照补全，工具层读非焦点 tab 正文需先切焦点（Step 3 无 select_tab，读非焦点 tab 的路径是 open_tab 指向同域或提示用户）。
  - dist/ 未提交（构建产物，沿用仓库现状）。
