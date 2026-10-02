---
step: 1
title: 协议 v4 与扩展侧 tab 管理
status: in_progress
---

## 目标
扩展具备「开 tab 入 Dogear 分组 / 关组内 tab / 列组内 tab」的命令执行能力，协议双侧同步到 v4。

## 依赖上下文（接力棒输入）
- 当前关键文件状态：`extension/manifest.json` permissions 为 `["nativeMessaging", "activeTab", "scripting", "storage"]`；`electron/main/services/browser/nm-protocol.ts` `ProtocolVersion = 3`，`CommandKind` 8 种（observe/find/click/fill/read_text/navigate/read_state/scroll）；`extension/src/background.js` `handleCommand` 按 `msg.kind` 分发（navigate 分支约 :171）。
- 关键决策回顾：焦点 tab 模型与 Dogear 分组定义见 plan.md 全局决策；SW 休眠恢复用 tabGroups.query({title})。

## 计划改动
- [ ] `extension/manifest.json`：permissions 加 `"tabs"`, `"tabGroups"`, `"contextMenus"`（contextMenus 为 Step 4 预埋）；version 0.1.0 → 0.2.0。
- [ ] `electron/main/services/browser/nm-protocol.ts`：`ProtocolVersion = 4`；`CommandKind` 加 `'open_tab' | 'close_tab' | 'list_tabs'`；新增 params 接口：`OpenTabCommandParams { targetUrl: string; background?: boolean }`、`CloseTabCommandParams { targetTabId?: number }`；`CommandErrorCode` 复用现有值不新增。
- [ ] `extension/src/nm-protocol.js`：同步 CommandKind 相关判定/文档注释（双侧副本纪律）。
- [ ] `extension/src/background.js`：
  - [ ] 常量 `DOGEAR_GROUP_TITLE = 'Dogear'`；`ensureDogearGroup(tabId)`：`chrome.tabGroups.group({tabIds, createProperties: {title, color}})`，颜色任选固定值（如蓝色）。
  - [ ] `handleCommand` 加三分支：
    - `open_tab`：校验 targetUrl 为 http/https 且 origin ∈ SW 侧授权列表（与现有 popup 授权同源，storage.local）→ `chrome.tabs.create({url, active: !background})` → 入组 → 回 `{tabId, url, title, pageState, focused: true}`（pageState 用 resolvePageState 判定）。
    - `close_tab`：targetTabId 缺省用当前受控 tabId；校验目标 ∈ Dogear 组（`tabGroups.query({title})` + tab.groupId 对照）→ `chrome.tabs.remove`；组外 tab 拒绝（回 `permission_denied` 错误文案「仅能关闭 Dogear 分组内的标签页」）。
    - `list_tabs`：列出组内 tab → `[{tabId, url, title, focused}]`，focused 标记当前受控焦点。
  - [ ] hello 帧 protocolVersion 报 4。
  - [ ] open_tab 成功后对该新 tab 推送 tab_snapshot（沿用现有快照链路，tabId 为新 tab）。
- [ ] 扩展重装验证：`chrome://extensions` 重载后手动测试三分支（可用 SW DevTools console 直接调 handleCommand 或经 popup 连接后由桌面端触发）。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - tab 管理三分支拆到新文件 `extension/src/tab-commands.js`（background.js 已约 390 行，内联会严重超 300 行约束）；background.js 仅接入 ctx + 前置分发 + hello v4。
  - `nav-tracker.js` 导出了原私有的 `waitForTabComplete`（open_tab 等待加载完成需复用，与 navigateTab 同一等待实现），属最小支持改动。
  - list_tabs 回包为 `data: { tabs: [...] }`（计划只写了数组形状，包一层对象便于后续扩展字段）。
  - close_tab 焦点回落：组内剩余 tab 按 `lastAccessed` 降序取最近使用者；组空则清空焦点。
- 改动文件清单：`extension/manifest.json`（0.2.0 + tabs/tabGroups/contextMenus）、`extension/src/nm-protocol.js`（双副本同步注释）、`extension/src/nav-tracker.js`（导出 waitForTabComplete）、`extension/src/tab-commands.js`（新建）、`extension/src/background.js`（ctx+分发+hello v4）、`electron/main/services/browser/nm-protocol.ts`（v4+CommandKind+params 接口）。
- 验证：`bun run build:electron`（tsc）通过；bun build 对 4 个扩展文件语法/模块解析通过。扩展重装手测待用户在 chrome://extensions 重载后进行。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 扩展侧分发入口：`handleTabCommand(msg, ctx) -> Promise<boolean>`（true 表示已处理并已 postResult）；ctx = `{ getFocusedTabId, setFocusedTab(tab), clearFocusedTab, pushSnapshot, fail(msg,code,text), postResult(msg,payload) }`（background.js TAB_COMMAND_CTX）。
  - open_tab 回包 `data: { tabId, url, title, pageState, focused: true }`（focused 恒 true，指操作焦点已切到新 tab，与前台 active 解耦）；open_tab 会切 SW 焦点（state.tabId）并推 tab_snapshot。
  - close_tab 回包 `data: { closedTabId, focusedTabId: number|null }`；组外 tab → `permission_denied`「仅能关闭 Dogear 分组内的标签页」。
  - list_tabs 回包 `data: { tabs: [{ tabId, url, title, focused }] }`，focused 指当前受控焦点。
  - 未授权域名 open_tab → `navigation_blocked`（与桌面端 validateNavigateTarget 同语义同文案风格）。
  - Dogear 组身份查询：`chrome.tabGroups.query({ title: 'Dogear' })`（蓝色），不靠内存集合，SW 休眠安全。
- 下个 step 该从哪里继续：Step 2 gateway 多 tab 状态模型——ExtensionStatus 泛化为焦点 tab + tabs 数组时，直接消费上述回包结构；命令帧带目标 tabId 的语义（三分支目前忽略帧 tabId、用 SW 焦点，gateway 侧需保证帧 tabId 与扩展焦点一致或依赖回包刷新）。
- 待办或已知限制：
  - 扩展重载手测未做（无浏览器环境），三分支行为待用户在 chrome://extensions 重载后验证。
  - nav-tracker 的 generations Map 在 tab 关闭后不清理（现状即如此，量级可忽略）。
  - SW 重启后 state.tabId 置空（现有行为），需 popup 重连恢复；三分支中 close_tab/list_tabs 此时可用，open_tab 会重设焦点。
