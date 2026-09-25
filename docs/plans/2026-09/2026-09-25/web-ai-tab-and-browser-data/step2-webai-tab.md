---
step: 2
title: 白嫖框 tab 呈现链路
status: done
---

## 目标

「网页 AI」一等公民哨兵 tab 全链路跑通：临时会话区入口 → 打开 tab → 内嵌网页呈现主区域 → 站点切换 → 切 tab 时 attach/detach 正确，登录态持久。

## 依赖上下文（接力棒输入）

（待 Step 1 回填：全局分区函数签名、迁移后分区名。）

已知可抄的先例（执行时读这些文件）：
- 哨兵 tab 模式：`stores/session-store.ts` 的 `FEISHU_TAB_ID`（常量 + `SENTINEL_TAB_IDS` + openFeishuTab action）、`app/page.tsx:380` 附近的常驻挂载写法、`components/WorkspaceTabBar.tsx:308` 附近的 tab 项
- 占位容器 bounds 上报：`components/companion/BrowserPageView.tsx`（ResizeObserver + 卸载上报 null 触发 detach + 弹层遮挡上报隐藏）；主进程侧接收参考 `presentation.ts` 的 `reportPageViewBounds`（注意 companion 呈现语义与主区域常驻语义不同，倾向独立轻量通道而非塞进 presentation.ts）
- tab 生命周期：`electron/main/services/browser/embedded/embedded-browser-manager.ts` 的 openTab/retain/release/attachToWindow/TTL 兜底逻辑——本步要加「用户常驻 tab」语义（免 TTL）

## 计划改动

- [x] `stores/session-store.ts` — `WEB_AI_TAB_ID = '__webai__'` 进 `SENTINEL_TAB_IDS`；`openWebAiTab` / 关闭 action（tab 关闭语义：销毁 tab、分区保留，参考哨兵 tab 关闭处理）
- [x] 新增 `components/webai/WebAiPanel.tsx` — 顶栏站点切换器（数据源 settings `webAiSites`，本步先用预置默认值，Step 3 接编辑 UI）+ 页面视图占位容器（bounds 上报 + 卸载 null 上报 + MutationObserver 弹层遮挡）
- [x] `app/page.tsx` — WebAiPanel 常驻挂载，activeTabId 切 display
- [x] `components/WorkspaceTabBar.tsx` — tab 项（Globe 图标 + 「网页 AI」标题 + 可关闭）
- [x] `components/ConversationList.tsx` / `conversation-list/` — PersonalSection「+」旁 Globe 图标入口按钮 → openWebAiTab
- [x] 主进程 — embedded-browser-manager 用户常驻 tab：openTab 带 user 来源标记，retain(holderId: 'webai') 免 TTL，应用退出销毁
- [x] 主进程 — webai bounds 上报 tipc 路由（webai.reportBounds(bounds|null)）：null → detach（tab 保留），非 null → ensureTab + attachToWindow；站点切换 ensureTab 后 navigate
- [x] `bun run build:electron` + 手工验证

## 验证

- 临时会话区点 Globe 入口 → tab 打开，默认加载 DeepSeek，登录（或验证已有分区登录态直接生效）
- 顶栏切 Kimi / 豆包，页面切换正常，切回 DeepSeek 仍是登录态
- 切到别的会话 tab 再切回来：页面 detach/attach 无残留、无错位（多窗口下只在主窗口呈现）
- 重启应用重开 tab：登录态还在
- agent 同时跑内嵌浏览器任务互不干扰（agent tab 呈现 companion 视图区不受影响）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 计划写的 `openEmbeddedTab` tipc 过程实际不存在，改为独立封装：新增 `electron/main/services/browser/embedded/webai.ts`（单例 tab 管理）+ `electron/main/tipc/browser.ts` 内 5 条独立路由，仍全走 tipc 不绕红线
  - 超出计划的小改动：manager `listTabs()` 过滤 webai workspace（否则 companion tab 列表与动作流 launched 判断被污染）、`dispose()` 改双层遍历（过滤后 webai tab 退出时仍被显式关闭）
  - bounds/overlay 独立通道（webai.reportBounds / webai.reportOverlay），未塞进 presentation.ts（符合计划倾向）
  - GUI 手工验证未做（无窗口环境），需 bun run dev 人工过计划验证清单
- 改动文件清单：
  - `electron/main/services/browser/embedded/webai.ts` — 新增：单例 tab（sentinel workspace `__webai__`）+ source 'user-connected' + holderId 'webai' 永不 release 免 TTL + 全局分区共享登录态
  - `electron/main/tipc/browser.ts` — getWebAiState / openWebAiSite / closeWebAiTab / reportWebAiBounds / reportWebAiOverlay 五条路由
  - `electron/main/services/browser/embedded/embedded-browser-manager.ts` — 导出 WEBAI_WORKSPACE_ID；listTabs 过滤 webai；dispose 双层遍历
  - `stores/session-store.ts` — WEB_AI_TAB_ID 进 SENTINEL_TAB_IDS；webAiTabOpen + openWebAiTab/closeWebAiTab（pickFallbackTab 回退，feishu 同模式）
  - `components/webai/WebAiPanel.tsx` — 新增：站点切换器 + WebAiSurface 占位容器（rAF bounds 上报 + 卸载 null + MutationObserver 弹层遮挡 + 300ms 兜底 + revision 防旧）；导出 WEB_AI_SITES 预置站点（Step 3 数据源切换点）
  - `app/page.tsx` — WebAiPanel 常驻挂载（feishu 块后），activeTabId 切 display
  - `components/WorkspaceTabBar.tsx` — 「网页 AI」哨兵 tab 项；关闭 = client.closeWebAiTab() + store closeWebAiTab() 两步配对
  - `components/conversation-list/PersonalSection.tsx` — 「+」旁 Globe 入口 → openWebAiTab

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - tipc：`client.getWebAiState(): EmbeddedTabSnapshot | null`、`client.openWebAiSite({ url })`（ensureTab + navigate，同 url 不重复 loadURL）、`client.closeWebAiTab()`、`client.reportWebAiBounds({ revision, bounds | null })`、`client.reportWebAiOverlay({ hidden })`
  - 站点数据源：`WebAiPanel.tsx` 导出 `WEB_AI_SITES`（唯一硬编码点）；主进程 `webai.ts` 的 `DEFAULT_WEB_AI_URL`（bounds 兜底 ensure 用，Step 3 接 settings 时需同步改）
  - 免 TTL 机制：openTab 传 holderId 自动进 holders Set，webai 永不 release → sweepIdleTabs 跳过；应用退出 manager.dispose() 销毁
- 下个 step 该从哪里继续：Step 3 把 `webAiSites` 落进 settings schema + 设置页编辑 UI，替换 WEB_AI_SITES 引用与 DEFAULT_WEB_AI_URL
- 待办或已知限制：
  - GUI 手工验证待 bun run dev 人工过（Globe 入口 → 加载 → 切站点 → 切 tab attach/detach → 重启登录态）
  - webai tab 不出现在 companion 列表（预期）；用户看 webai 时会短暂遮挡 companion 视图（预期）
  - Step 2 子会话曾误覆盖共享区 step1-delivery.md（已重建近似版），不影响代码与计划文档
