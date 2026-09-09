---
step: 4
title: 浏览器面板主体化
status: pending
---

## 目标

浏览器面板改为「页面为主体」：地址栏 + 页面占满 + 等待人工横幅 + 接管按钮 + 日志折叠；bounds 同步换 rAF+revision+lastBounds 对齐 Proma，拖拽跟手。

## 依赖上下文（接力棒输入）

- Step 2 产出：takeover 路由与 `browser-store` takeovers 状态、`resumeConversation` glue、接管控件已在 `BrowserPageView.tsx` tab 行最小实现
- `BrowserPanel.tsx` 现状：StatusLine + BrowserInterventions + BrowserPageView（h-52 小窗）+ 动作日志流占满
- `BrowserPageView.tsx` 现状：`REPORT_DEBOUNCE_MS = 120` 防抖 + `reportPageViewBounds` IPC + 卸载上报 null
- Proma 参照：`C:/Proma/apps/electron/src/renderer/components/browser/BrowserSlot.tsx`（rAF 每帧 publish + 全局单调 revision + ResizeObserver + 立即 publish on mount）、`browser-controller.ts:900` lastBounds 恢复、每 tab 独立 revision 拒晚到布局
- 前端 tab：`client.presentEmbeddedTab` / `dismissPresentedTab` 已有；地址栏导航/后退/前进/刷新需要新 tipc
- 设计文档：第三批 8/9/10

## 计划改动

- [ ] `embedded-browser-manager.ts`：新增 `navigateTabAsUser(tabId, url)`（作用于呈现 tab，与 agent tab 分离）、`goBack/goForward/reload(tabId)`（webContents.navigationHistory / goBack / goForward / reload，等加载就绪后返回新 snapshot）——注意这些只允许作用于非 agent 操作目标或 takeover 中的 tab 呈现（activeTabId 本就与 agentTabId 分离，直接操作 presented tab 即可）
- [ ] `tipc/browser.ts`：`navigatePresentedTab` / `goBackPresentedTab` / `goForwardPresentedTab` / `reloadPresentedTab` 四路由
- [ ] `presentation.ts`：bounds 记录加每 tab `lastBounds`；attach 时优先恢复 lastBounds；`reportPageViewBounds` 带 `revision` 参数（渲染层全局单调，对齐 Proma `browser-layout-revision` 模型：每个 tab 记最新 revision，晚到的低 revision 直接忽略）
- [ ] `BrowserPageView.tsx`：去 120ms 防抖 → `useLayoutEffect` 内 rAF 每帧 publish（ResizeObserver + window resize + mount 立即 publish 一次，卸载 publish null），revision 用模块级计数器；URL 输入框回车调 `navigatePresentedTab`；后退/前进/刷新按钮（canGoBack/canGoForward 状态从 snapshot 取，拿不到就常显）
- [ ] `BrowserPanel.tsx` 重构布局（自上而下）：等待人工横幅（pending 时置顶，替代独立卡片区块）→ 42px 地址栏（后退/前进/刷新/URL/呈现 tab 名 + 接管/交还按钮）→ **页面占满 flex-1**（原 h-52 小窗删除）→ 底部日志抽屉（默认收起一行「操作记录 N 条」，点击展开 max-h-64 滚动，复用现有 ActionCard 流）
- [ ] `browser-store.ts`：view 状态加 presented tab 的 canGoBack/canGoForward（getPageViewState 返回结构扩展）+ 动作流仍走折叠抽屉
- [ ] 动作日志在页面呈现时的可见性：抽屉默认收起即可，无额外联动
- [ ] `EmbeddedTabSnapshot`（embedded/types.ts）：tab 快照加 `canGoBack/canGoForward`（webContents.navigationHistory.canGoBack）

## 验收

- 浏览器 tab 选中时：地址栏可用（输入 URL 呈现 tab 导航）、后退前进刷新工作、页面占满面板、等待人工横幅置顶可见、日志默认收起
- 拖拽窗口/分隔条：WebContentsView 跟手无肉眼滞后（rAF 链路）；tab 切换呈现无白屏（mount 立即 publish + lastBounds 恢复）
- 地址栏导航只影响呈现 tab，agent 正在操作的 tab 不受影响（agentTabId 不变）
- `bun run build:electron` + `bun run lint` + 前端 `bun run dev:renderer` 手工过一遍五验收场景（见 plan.md 目标）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
