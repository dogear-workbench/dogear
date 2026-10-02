---
step: 1
title: 协议 v4 与扩展侧 tab 管理
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
