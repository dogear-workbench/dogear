---
step: 3
title: agent 智能跟随
status: done
---

## 目标
agent 导航产生新 tab 时（原子工具 navigate 开新 tab、fetch 失败页 promote），呈现状态为 null 或 agent 旧 tab 的窗口自动跟随呈现新 tab；用户手动呈现别的 tab 后不打扰。

## 依赖上下文（接力棒输入）
- 无前置 step 依赖。关键现状：
  - `electron/main/services/browser/embedded/presentation.ts`：`presentTab` 内部 `pickCompanionWindow()` 自选窗口（不接收目标窗口参数）；`attachWithBounds(tabId, win, bounds)` 会 detach 本窗口旧呈现并 `release(PRESENT_HOLDER_ID)`、attach 新 tab；`boundsByWindow` 是 `Map<number, Rectangle>`，取窗口对象用 `BrowserWindow.getAllWindows().find(w => w.id === id)`
  - `electron/main/services/browser/embedded/navigate.ts` `navigateTab`：无 agent tab 时 `openTab({source: 'agent-opened'})` 开新 tab（有则同 tab loadURL——同 tab 导航天然可见，无需跟随）
  - `electron/main/services/browser/embedded/fetch-page.ts:98` `promoteFetchTab(manager, tabId, holderId)`：`promoteToAgentTab` + `release`；失败页强呈现走 `presentTabWindow`（保持不动）
  - import 方向约束：navigate/fetch-page → presentation → manager，manager 不得 import presentation（防环）
- 关键决策回顾：跟随呈现要 `retain(toTabId, 'companion-present')` 与用户手动呈现同生命周期，否则 agent 结束 release 后 tab 会被 TTL 回收直接关掉用户正看的页面

## 计划改动
- [ ] `electron/main/services/browser/embedded/presentation.ts` 新增 `followAgentNavigation(manager, fromTabId: string | null, toTabId: string)`：遍历 `BrowserWindow.getAllWindows()` 中 `boundsByWindow.has(win.id)` 的窗口，`tabIdByWindow.get(win.id)` ∈ {undefined/null, fromTabId} 时 → `manager.retain(toTabId, PRESENT_HOLDER_ID)` + `attachWithBounds(toTabId, win, attachBoundsFor(toTabId, win))`
- [ ] `electron/main/services/browser/embedded/navigate.ts` `navigateTab` 开新 tab 分支：`waitTabReady` 成功后调 `followAgentNavigation(manager, null, snapshot.tabId)`
- [ ] `electron/main/services/browser/embedded/fetch-page.ts` `promoteFetchTab`：promote 前记录旧 agentTabId（`manager.getAgentTabId(tab.workspaceId)`，workspaceId 从 `manager.getTabRecord(tabId)` 取），promote 后调 `followAgentNavigation(manager, 旧agentTabId, tabId)`
- [ ] `bun run build:electron` 重编译 + 真机验证

## 验证
- 面板开浏览器 tab、无呈现 → agent `dogear__browser__navigate` 新站点 → 页面视图自动呈现该 tab
- 呈现的正是 agent 旧 tab → agent 换新 tab 后视图自动跟过去
- 手动呈现另一个 tab → agent 导航不打扰（视图不动）
- 无面板窗口（bounds 未上报）→ 跟随静默跳过，无报错
- fetch 失败页 promote → 窗口呈现旧 agent tab 或无呈现时跟到失败页；presentTabWindow 强呈现行为不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。两处微小补充：① promoteFetchTab 里 workspaceId 取不到时 previousAgentTabId 记 null（此时 promote 本身 no-op，退化为仅空呈现窗口跟随，安全）；② 函数注释各一行（WHY 非显而易见）
- 改动文件清单：
  - `electron/main/services/browser/embedded/presentation.ts:145-160` — 新增 `followAgentNavigation(manager, fromTabId: string | null, toTabId: string)`：pruneWindowEntries → 遍历 bounds 已上报窗口 → 呈现为 undefined 或 === fromTabId 才 `manager.retain(toTabId, PRESENT_HOLDER_ID)` + `attachWithBounds(...)`
  - `electron/main/services/browser/embedded/navigate.ts:21` — navigateTab 开新 tab 分支 waitTabReady 成功后 `followAgentNavigation(manager, null, snapshot.tabId)`（超时抛错不跟随）；同 tab loadURL 分支不加
  - `electron/main/services/browser/embedded/fetch-page.ts:97-105` — promoteFetchTab：promote 前记旧 agentTabId（getTabRecord→getAgentTabId），promote+release 后跟随
- 验证：`bun run build:electron` + `bun run lint`（0 errors，改动文件零告警）通过；真机 GUI 五项场景待用户（无呈现跟随 / 旧 tab 跟随 / 手动呈现不打扰 / 无面板静默 / promote 失败页跟随）

### 给下一步的接力棒
- 关键签名 / 数据结构：`followAgentNavigation(manager: EmbeddedBrowserManager, fromTabId: string | null, toTabId: string): void`（presentation.ts 导出）
- 下个 step 该从哪里继续：Step 2 在 presentation.ts 加 overlayHiddenByWindow + setOverlayHidden，与 followAgentNavigation 无冲突；overlay 恢复时可复用 attachWithBounds 兑底
- 待办或已知限制：① presentation ↔ navigate 函数级 import 环为既有状态（presentation.ts:3 waitTabReady 引用先于本次存在），均为调用期访问，ES2020 ESM 安全；② 多合格面板窗口时最后处理的窗口实际持有视图（单主窗口现状无感知）；③ dev-selftest.ts 也调 navigateTab，自测环境无 bounds 上报窗口静默跳过
