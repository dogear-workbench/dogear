---
step: 2
title: 弹层遮挡临时隐藏
status: done
---

## 目标
任何 Radix 弹层（下拉菜单、对话框等）与页面视图区相交时，主进程临时 `setVisible(false)` 隐藏浏览器画面，弹层消失后恢复；面板外弹层不影响。

## 依赖上下文（接力棒输入）
- 无前置 step 依赖（Step 1 可先行或跳过）。关键现状：
  - `components/companion/BrowserPageView.tsx` 的 `PageSurface`：已有 rAF+revision bounds 上报链路（ResizeObserver + 300ms 兜底 + 卸载 commit(null)）
  - `electron/main/services/browser/embedded/presentation.ts`：`boundsByWindow` / `tabIdByWindow` / `latestRevisionByWindow` 三 Map；`reportPageViewBounds` 收 null 时 detach；`attachWithBounds` 内 `setVisible(true)`
  - WebContentsView 永远浮在 HTML 之上，DOM z-index 无效——这是本步存在的根因
- 关键决策回顾：overlay 通道与 bounds-null detach 分离，不动 retain/release，避免 tab 被空闲回收与呈现状态丢失

## 计划改动
- [ ] `electron/main/services/browser/embedded/presentation.ts`：
  - 新增 `overlayHiddenByWindow: Map<number, boolean>` 与 `setOverlayHidden(win, hidden)`：hidden=true 记状态 + 对 `tabIdByWindow` 当前 tab `getView()?.setVisible(false)`；hidden=false 清状态 + tab 仍 attached 本窗口则 `setVisible(true)`，否则 boundsByWindow 有记录则 `attachWithBounds` 重挂兜底
  - `reportPageViewBounds` 里 attachWithBounds 调用后检查 overlay 状态：仍 hidden 则重新 `setVisible(false)`（防新 bounds 上报把隐藏顶掉）
  - `pruneWindowEntries` 一并清理 overlay Map
- [ ] `electron/main/tipc/browser.ts`：新增 `reportPageViewOverlay` 路由，input `{hidden: boolean}`，`windowFromContext` 取窗口调 `setOverlayHidden`
- [ ] `components/companion/BrowserPageView.tsx` 的 `PageSurface`：
  - `useLayoutEffect` 内起 `MutationObserver(document.body, {childList: true, subtree: true})`
  - 检测函数：`document.querySelectorAll('[data-radix-popper-content-wrapper], [role="dialog"]')`，排除 tooltip（元素内 `querySelector('[role="tooltip"]')` 命中或自身 role=tooltip 的跳过）；任一元素 rect 与视图区 el rect 相交 → hidden
  - 状态去抖：与上次不同才 `client.reportPageViewOverlay({hidden})`；卸载时 stop observer（不需要恢复上报，卸载本身走 detach）
- [ ] `bun run build:electron` 重编译 + 真机验证

## 验证
- 呈现页面时点开「呈现的标签页」下拉菜单（覆盖视图区）→ 浏览器画面消失、菜单可见可点；关闭菜单 → 画面恢复
- 打开任意对话框（如 showConfirm）覆盖视图区 → 画面隐藏；关闭恢复
- 弹层出现在主区域不与视图区相交 → 画面不隐藏
- overlay hidden 期间拖动面板宽度（bounds 变化）→ 画面保持隐藏不闪现

## 实施回填（做完后填）

### 实际改动
- 与计划差异（三处合理增强）：① 选择器补 `[role="alertdialog"]`——showConfirm 走 Radix AlertDialog，不加则验证项必失败；② overlay 守卫从「reportPageViewBounds 内」上移到 `attachWithBounds` 尾部，超集覆盖 presentTab / followAgentNavigation 等所有挂载路径（弹层开着时 agent 跟随切 tab 不闪现）；③ mount 时 `syncOverlay(true)` 强制上报一次，修复 hidden 期间 renderer 重载→主进程残留 true→永久黑屏边界
- 改动文件清单：
  - `electron/main/services/browser/embedded/presentation.ts:32` — `overlayHiddenByWindow: Map<number, boolean>`；:60-79 `setOverlayHidden(win, hidden)`（hidden 只 setVisible(false) 不碰 retain/release；恢复时 attachedWindow 匹配则 setVisible(true)，否则 bounds 有记录 attachWithBounds 重挂兑底）；:209 attachWithBounds 尾部 overlay 守卫；:229 pruneWindowEntries 清理
  - `electron/main/tipc/browser.ts:134-140` — `reportPageViewOverlay` 路由，input `{hidden: boolean}`，windowFromContext 取窗口
  - `components/companion/BrowserPageView.tsx:109-147` — PageSurface useLayoutEffect 内 detectOverlay（popper wrapper / dialog / alertdialog 与视图区 AABB 相交，排除 tooltip，视图区 <1px 不 hidden）+ syncOverlay（rAF 合帧 + 状态去抖）+ MutationObserver(document.body, childList+subtree)；卸载停 observer 不恢复上报
- 验证：`bun run build:electron` + `bun run lint`（0 errors，改动文件零 warning）通过；真机 GUI 四项待用户（下拉菜单遮挡隐藏/恢复、showConfirm 遮挡、主区域弹层不隐藏、hidden 拖宽不闪现）

### 给下一步的接力棒
- 关键签名 / 数据结构：`setOverlayHidden(win: BrowserWindow, hidden: boolean): void`；渲染层 `client.reportPageViewOverlay({ hidden: boolean })`
- 下个 step 该从哪里继续：本 step 为最后一个 step，全部完成
- 待办或已知限制：① MutationObserver 挂 body subtree 会随 agent 流式输出高频触发，已 rAF 合帧 + 轻量查询，真机可观察；② 检测依赖 Radix DOM 约定，非 Radix 自定义浮层不触发（当前 UI 统一 shadcn/Radix，无此场景）
