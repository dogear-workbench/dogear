---
step: 1
title: 地址栏常驻与 URL 直开
status: done
---

## 目标
无 tab / 无呈现 tab 时地址栏也常驻可输入，回车以 URL 开新 tab 并呈现到本窗口；有呈现 tab 时导航行为不变。

## 依赖上下文（接力棒输入）
- 无前置 step。关键现状：
  - `components/companion/BrowserPageView.tsx:57` `if (tabs.length === 0) return null` 导致地址栏不渲染；input `disabled={!presented}`
  - `submitUrl`（BrowserPageView.tsx 约 :160）现只走 `client.navigatePresentedTab`
  - 后端 `electron/main/tipc/browser.ts` 的 `presentEmbeddedTab` 已支持 `{url, workspaceId}` 分支：开新 tab（holderId=companion-present）→ presentTab 到本窗口
  - `CompanionPanel.tsx:138` `<BrowserPanel />` 未传 props，但组件本身有 `workspaceId` prop 可用

## 计划改动
- [ ] `components/companion/CompanionPanel.tsx:138` `<BrowserPanel workspaceId={workspaceId} />`
- [ ] `components/companion/BrowserPanel.tsx` 接 `workspaceId` prop 转传 `<BrowserPageView workspaceId={...} />`
- [ ] `components/companion/BrowserPageView.tsx`：
  - 删 `tabs.length === 0` 早退，`<PageAddressBar>` + `<PageSurface/>` 常驻
  - input 去掉 disabled；placeholder 无 presented 时改「输入网址回车打开」
  - `submitUrl`：无 presented → `normalizeUrl` 后 `client.presentEmbeddedTab({url, workspaceId})`；有 presented → 现状 navigatePresentedTab
  - draft 保护：input focus 期间置 editing 标记，自动重置 draft 的 useEffect（现依赖 `[presented?.tabId, presented?.url]`）在 editing 时跳过
  - PageSurface 占位文案 presented 为 null 时改为「未呈现页面 · 输入网址或从右侧菜单选择」
- [ ] `bun run build:electron` 不需要（纯渲染层），`bun run dev` 真机验证

## 验证
- 无任何 tab 时打开浏览器 tab：地址栏可见、可输入；输入 `example.com` 回车 → 开新 tab 呈现
- 有 presented 时输入新 URL 回车 → 当前 tab 导航（现状不变）
- 地址栏打字中途 agent 切换呈现 tab → 输入内容不被重置
- 无 tab 时 PageSurface 上报 bounds（`getPageViewState` 的 hasPageView 应为 true）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。两处自然延伸：① blur 时 draft 同步回 presented.url（Chrome 失焦恢复行为，计划未规定）；② 删 disabled 时一并清理 className 残留的 `disabled:opacity-60`
- 改动文件清单：
  - `components/companion/CompanionPanel.tsx:138` — `<BrowserPanel workspaceId={workspaceId} />`
  - `components/companion/BrowserPanel.tsx` — 新增 `BrowserPanelProps { workspaceId: string }`，转传给 BrowserPageView
  - `components/companion/BrowserPageView.tsx` — 删 `tabs.length === 0` 早退；`submitUrl` 无 presented 分支走 `client.presentEmbeddedTab({url, workspaceId})`；input 去 disabled + onFocus/onBlur editing 标记保护 draft（editing 时跳过自动重置 effect）；placeholder/占位文案改中文引导语
- 验证：`bun run lint` 0 errors、`bunx tsc --noEmit` 通过；真机 GUI 验证待用户（无 tab 直开 / 有 presented 导航不变 / 打字中切 tab 不清空 / hasPageView=true）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `BrowserPageView({ workspaceId }: { workspaceId: string })`
  - `PageAddressBar({ presented, tabs, workspaceId }: {...})`，新增 `editing` state（onFocus/onBlur）
  - 后端复用未动：`client.presentEmbeddedTab({ url, workspaceId })`（tipc/browser.ts url 分支）
- 下个 step 该从哪里继续：Step 2 在 BrowserPageView.tsx 的 PageSurface 加 MutationObserver，与本次改动无冲突区域
- 待办或已知限制：无 tab 时 BrowserPanel 的 `<EmptyState>`（暂无浏览器动作）仍显示在 PageSurface 下方，与 PageSurface 占位文案并存；视觉可接受，如嫌重复后续单独处理
