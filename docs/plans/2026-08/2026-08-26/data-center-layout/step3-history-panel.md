---
step: 3
title: 执行历史面板化
status: pending
---

## 目标
把 HistorySheet 的内容从侧滑 Sheet 拆出来，平铺为一级 tab 面板，筛选器换 shadcn Select，运行中区块接轮询自动刷新。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-page-shell.md] `history` tab 已挂占位 `app/data-center/history-panel.tsx`；shadcn Select 可用
- 当前关键文件状态：`app/data-center/scheduler/HistorySheet.tsx` 含 Sheet 外壳 + 任务/状态两个原生 select 筛选 + RunningSection + 卡片列表 + 加载更多；数据走 `useSchedulerStore` 的 `history / historyLoading / historyError / historyCursor / loadingMore / loadHistory / loadMoreHistory / refreshActivity`
- 关键决策回顾：activity 现在只在 Sheet 打开时读一次；平铺后接 `useVisiblePolling`（`hooks/use-visible-polling`，SchedulerPanel 同款，10s）让 RunningSection 活起来

## 计划改动
- [ ] `app/data-center/history-panel.tsx`（step2 占位文件）填充实现：以 HistorySheet.tsx 主体逻辑为底，去 Sheet/SheetContent 外壳，改为满高布局（`h-full overflow-y-auto`，列表区滚动）
- [ ] 筛选行：任务筛选 + 状态筛选换 shadcn Select（`STATUS_OPTIONS`、`handleTaskFilterChange` 逻辑照搬：任务筛选调 `loadHistory(taskId)`，状态筛选纯前端过滤）+ 刷新按钮（保留）
- [ ] 数据加载时机：Sheet 的 `open` 条件改为组件挂载即 `loadHistory()`（tab 激活时挂载，shadcn Tabs 非激活不渲染）；分钟 tick 定时器保留
- [ ] 接 `useVisiblePolling(() => refreshActivity(), 10_000)`；RunningSection 照搬
- [ ] `HistoryEntryCard` + `history-utils` 不动，引用路径随迁移调整（卡片组件可留在 `scheduler/` 目录或随迁 `data-center/`，以实际目录整洁度定，保持 import 简单）
- [ ] 删除 `app/data-center/scheduler/HistorySheet.tsx`；`SchedulerPanel.tsx` 删「查看执行历史」按钮、`historyOpen` 状态、HistorySheet 引用
- [ ] 验证：执行历史 tab 下筛选/刷新/加载更多正常；手动「立即运行」一个任务，运行中区块 10s 内自动出现；SchedulerPanel 不再有历史入口

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：`app/data-center/scheduler/TaskEditor.tsx` 改造为页面内 TaskEditorPage
- 待办或已知限制：
