---
step: 1
title: 内嵌宿主骨架
status: done
---

## 目标

建立内嵌 WebContentsView 宿主的基础设施：view/tab 生命周期管理、persistent partition、诚实 UA、后台与可见双模式，为后续观察能力（Step 2）提供载体。

## 依赖上下文（接力棒输入）

- 参考实现：`C:\Proma\apps\electron\src\main\lib\browser-controller.ts`（tab/view 生命周期）、`browser-profile-policy.ts`（partition）、`browser-identity.ts`（UA，全文 11 行）
- dogear 现状：无内嵌 view 代码；主窗口与 companion 窗口管理见 `electron/main/`（执行时定位具体 window 服务）
- 关键决策回顾：诚实 UA（去 Electron 标记 + `Dogear/{version}`）；partition 按 workspace 隔离；activeTabId/agentTabId 分离设计在 Tab 模型内置，但本步只建模型字段，双 tab 行为在 Step 6 呈现层才用

## 计划改动

- [ ] 新建 `electron/main/services/browser/embedded/embedded-browser-manager.ts`：WebContentsView 创建/销毁、tab 注册表（Map<tabId, record>）、后台模式（不 attach 任何窗口，view 独立加载）、attach/detach 到指定 BrowserWindow 的能力（Step 6 用，本步只留接口）
- [ ] 新建 `embedded/profile.ts`：`resolveProfileKey(workspaceId)` + `buildPersistentPartition(profileKey)`（sha256 截断 32，`persist:dogear-browser-<hash>`）
- [ ] 新建 `embedded/ua.ts`：默认 UA 去 `Electron/` 标记 + 追加 `Dogear/{app.getVersion()}`，session 级 setUserAgent
- [ ] Tab 模型类型定义：`{ tabId, source: 'agent-opened' | 'user-connected', url, title, generation, state }`（generation 本步只递增计数，语义校验在 Step 2）
- [ ] 导航事件挂接：did-navigate / did-navigate-in-page → generation++、更新 url/title/state
- [ ] 空闲回收：无活动会话引用的 tab 定时关闭（防泄漏）
- [ ] 主进程侧最小自测路径：dev 模式下能开一个后台 tab 加载 URL 并拿到 title

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - attach/detach 做了真实最小实现而非空接口（addChildView/removeChildView + setBounds + visible + activeTabId 维护），Step 6 可直接用
  - 计划外新增：before-quit dispose 挂接（与 openTab 对称防泄漏）；openTab 入口 http(s) 协议白名单防呆；window.open 一律 deny + log（后续 step 按需放行）
  - generation 递增点：did-start-loading（跨文档导航/reload）与 did-navigate-in-page（SPA）各 +1，did-navigate 不重复计——一次跨文档导航恰 +1
- 改动文件清单：
  - 新增 `electron/main/services/browser/embedded/`：types.ts（Tab 模型 + 8 态枚举）、profile.ts（partition）、ua.ts（诚实 UA）、tab-events.ts（导航事件→generation/state）、embedded-browser-manager.ts（管理器单例）、dev-selftest.ts（env 门控自测）
  - 修改 `electron/main/main-app.ts`：dev 自测入口 + before-quit dispose
  - Patchright browser-manager.ts 未动（按计划，Step 6 删）
- 验证：lint 0 errors、build:electron（tsc strict）通过、运行时自测实测（example.com 加载拿 title，generation=1）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `getEmbeddedBrowserManager()` 单例；`openTab({workspaceId, url, source, holderId?}): EmbeddedTabSnapshot`、`closeTab/retain/release(tabId, holderId)`、`getTab/listTabs`、`getAgentTabId/getActiveTabId(workspaceId)`、`attachToWindow(tabId, window, bounds?)`、`detachFromWindow(tabId)`、`dispose()`
  - `EmbeddedTabSnapshot = {tabId, source, workspaceId, url, title, generation, state, attached, holders}`（可序列化，不含 view）
  - workspace 注册表以 profileKey 为键，同 workspace 共享 persist partition；空闲回收 30s 扫描 / 3min TTL（无 holder + 未 attach）
- 下个 step 该从哪里继续：Step 2 需在 manager 加 `getView(tabId)` accessor（snapshot 有意不含 view）；cdp-session attach `webContents.debugger` 后重连 generation++ 挂点参考 Proma recoverDebugger；login_required 等状态判定规则集中到协议层单文件，不散进 tab-events
- 待办或已知限制：
  - popup（window.open/target=_blank）一律 deny，Step 4 抓取如遇新窗口跳转需评估放行
  - agent 工具持有 tab 必须 `retain(tabId, holderId=conversationId)` 否则 3min 被回收
  - tab-events ↔ manager 循环引用用 `import type` 解开，新文件沿用此模式
