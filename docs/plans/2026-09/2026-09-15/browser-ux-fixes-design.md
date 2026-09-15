# 浏览器面板三处体验修复 设计

**背景**：伴随面板「浏览器」tab 存在三个体验问题——① 无 tab / 无呈现时地址栏不渲染或被禁用，用户无法手动输入 URL；② WebContentsView 是原生视图永远浮在 HTML 之上，任何覆盖页面视图区的弹层（下拉菜单、对话框）都被它盖住看不见；③ agent 导航开新 tab 时页面视图不跟随，用户无法实时观察 agent 所在页面。

**目标**：地址栏常驻可随时输入 URL 直开；弹层出现时临时隐藏浏览器画面、关闭后恢复；agent 导航按「智能跟随」策略自动切换呈现。

**架构**：
1. 地址栏常驻 = 纯渲染层改动，放开输入并接已存在的 `presentEmbeddedTab({url, workspaceId})` 后端分支（tipc/browser.ts 已支持 url 直开）。
2. 弹层遮挡 = 渲染层 MutationObserver 检测 Radix portal 弹层与视图区相交 → 新 IPC `reportPageViewOverlay` → 主进程对呈现 tab `setVisible(false)`。不动 retain/release 生命周期，与面板收起的 bounds-null detach 通道分离。排除选项：逐弹层组件接 onOpenChange（侵入且漏新增弹层）；弹层改原生 BrowserWindow（重、体验差）。
3. 智能跟随 = `presentation.ts` 新增 `followAgentNavigation(manager, fromTabId, toTabId)`：遍历上报过 bounds 的窗口，当前呈现为 null 或正是 agent 旧 tab 时自动呈现新 tab。挂点：`navigate.ts` 开新 tab 分支（from=null）与 `fetch-page.ts` 的 `promoteFetchTab`（from=旧 agentTabId）。用户手动呈现别的 tab 后不跟随。排除选项：始终跟随（打断用户浏览）；纯手动按钮（丢失实时观察价值）。

**模块边界**：
- `components/companion/CompanionPanel.tsx` — 传 workspaceId 给 BrowserPanel
- `components/companion/BrowserPanel.tsx` — 接 props 转传
- `components/companion/BrowserPageView.tsx` — 地址栏常驻、URL 直开、draft 焦点保护、overlay 检测 observer
- `electron/main/tipc/browser.ts` — 新增 reportPageViewOverlay 路由
- `electron/main/services/browser/embedded/presentation.ts` — overlay 状态 + followAgentNavigation
- `electron/main/services/browser/embedded/navigate.ts` — 开新 tab 后跟随
- `electron/main/services/browser/embedded/fetch-page.ts` — promoteFetchTab 跟随

**数据流**：
- URL 直开：输入回车（无 presented）→ `client.presentEmbeddedTab({url, workspaceId})` → presentTab 开新 tab（source: agent-opened 但 holderId=companion-present，不占 agent tab）→ attach 到本窗口
- 弹层遮挡：MutationObserver(body) → 弹层 rect ∩ 视图区 rect → `client.reportPageViewOverlay({hidden})` → setVisible(false/true)
- 智能跟随：agent navigate 开新 tab / fetch 失败页 promote → followAgentNavigation → 各合规窗口 attachWithBounds + retain(PRESENT_HOLDER_ID)

**错误处理 / 边界情况**：
- overlay hidden 期间收到新 bounds 上报（attachWithBounds 会 setVisible(true)）→ attach 后重应用 overlay 状态
- overlay 恢复时 tab 已被 `ensureInputReady` 挪走 → boundsByWindow 仍有则重新 attachWithBounds 兜底
- 用户正在地址栏打字（focus）→ 跟随切换不重置 draft
- 地址栏常驻后无 tab 时 PageSurface 也上报 bounds → `pickCompanionWindow` 能命中，顺带修好「面板开着但无 tab 时 agent present 走全屏兜底」的隐性缺陷
- promote 场景的无条件强呈现（presentRecordToCompanion，登录/验证页）保持现状不动，跟随是温和补充
- 接管期间 agent 写工具被拒，天然不触发跟随

**未决问题**：无（关键决策均已拍板：遮挡场景 A、跟随策略智能跟随 A）。
