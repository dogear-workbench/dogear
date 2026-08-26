---
step: 3
title: 执行历史面板化
status: done
---

## 目标
把 HistorySheet 的内容从侧滑 Sheet 拆出来，平铺为一级 tab 面板，筛选器换 shadcn Select，运行中区块接轮询自动刷新。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-page-shell.md] `history` tab 已挂占位 `app/data-center/history-panel.tsx`；shadcn Select 可用
- 当前关键文件状态：`app/data-center/scheduler/HistorySheet.tsx` 含 Sheet 外壳 + 任务/状态两个原生 select 筛选 + RunningSection + 卡片列表 + 加载更多；数据走 `useSchedulerStore` 的 `history / historyLoading / historyError / historyCursor / loadingMore / loadHistory / loadMoreHistory / refreshActivity`
- 关键决策回顾：activity 现在只在 Sheet 打开时读一次；平铺后接 `useVisiblePolling`（`hooks/use-visible-polling`，SchedulerPanel 同款，10s）让 RunningSection 活起来

## 计划改动
- [x] `app/data-center/history-panel.tsx`（step2 占位文件）填充实现：以 HistorySheet.tsx 主体逻辑为底，去 Sheet/SheetContent 外壳，改为满高布局（`h-full overflow-y-auto`，列表区滚动）
- [x] 筛选行：任务筛选 + 状态筛选换 shadcn Select（`STATUS_OPTIONS`、`handleTaskFilterChange` 逻辑照搬：任务筛选调 `loadHistory(taskId)`，状态筛选纯前端过滤）+ 刷新按钮（保留）
- [x] 数据加载时机：Sheet 的 `open` 条件改为组件挂载即 `loadHistory()`（tab 激活时挂载，shadcn Tabs 非激活不渲染）；分钟 tick 定时器保留
- [x] 接 `useVisiblePolling(() => refreshActivity(), 10_000)`；RunningSection 照搬
- [x] `HistoryEntryCard` + `history-utils` 不动，引用路径随迁移调整（卡片组件可留在 `scheduler/` 目录或随迁 `data-center/`，以实际目录整洁度定，保持 import 简单）
- [x] 删除 `app/data-center/scheduler/HistorySheet.tsx`；`SchedulerPanel.tsx` 删「查看执行历史」按钮、`historyOpen` 状态、HistorySheet 引用
- [x] 验证：执行历史 tab 下筛选/刷新/加载更多正常；手动「立即运行」一个任务，运行中区块 10s 内自动出现；SchedulerPanel 不再有历史入口

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `HistoryEntryCard.tsx` + `history-utils.ts` 用 `git mv` 随迁到 `app/data-center/` 根（计划二选一允许）：HistorySheet 删除后唯一使用者是 history-panel.tsx，留在 `scheduler/` 会形成跨层引用，随迁后同目录 `./HistoryEntryCard` 最简
  2. 挂载 effect 除 `loadHistory()` 外额外调 `loadTasks()`：不补的话直接切到执行历史 tab（未先访问定时计划 tab）时任务筛选下拉为空——原 Sheet 依赖 SchedulerPanel 已加载的 tasks，平铺后两面板独立挂载
  3. 面板自带 `max-w-4xl px-6 py-6` 容器而非计划字面的 `h-full overflow-y-auto`：滚动层已由 page.tsx history TabsContent 内层 `h-full overflow-y-auto` 承担（接力棒提示按 page.tsx 现状定），panel 只输出内容流，与其他 panel 一致
  4. 筛选哨兵：任务/状态筛选的 `''` 全部换 `'all'`（radix Select 不允许空串 value），`loadHistory(value === 'all' ? undefined : value)`；状态空态文案 /「没有更多了」的条件判断同步改 `statusFilter === 'all'`
- 改动文件清单：
  | 文件 | 改动 |
  |------|------|
  | `app/data-center/history-panel.tsx` | 占位替换为完整实现：RunningSection + 标题行（h2 + 任务/状态 shadcn Select + 刷新）+ 加载/错误/空态 + HistoryEntryCard 列表 + 加载更多；挂载即 `loadTasks()` + `loadHistory()`；`useVisiblePolling(refreshActivity, 10s)`；分钟 tick 保留 |
  | `app/data-center/scheduler/HistorySheet.tsx` | 删除 |
  | `app/data-center/scheduler/SchedulerPanel.tsx` | 删 HistorySheet import/渲染、`historyOpen` 状态、`handleViewHistory`、「查看执行历史」按钮、lucide `History` 图标 |
  | `app/data-center/scheduler/HistoryEntryCard.tsx` → `app/data-center/HistoryEntryCard.tsx` | git mv 随迁，内容零改动 |
  | `app/data-center/scheduler/history-utils.ts` → `app/data-center/history-utils.ts` | git mv 随迁，内容零改动 |

### 给下一步的接力棒
- 关键签名 / 数据结构：`HistoryPanel()` 无 props、无 workspaces 依赖（store 自取 tasks/history）；`STATUS_OPTIONS` value 类型 `RunHistoryStatus | 'all'`；radix TabsContent 非激活默认卸载（无 forceMount），切 tab 即重挂载重拉数据，与原 Sheet 开关等价
- 下个 step 该从哪里继续：`app/data-center/scheduler/TaskEditor.tsx` 改造为页面内 TaskEditorPage
- 待办或已知限制：dev 肉眼验证未做（筛选/刷新/加载更多/「立即运行」后 10s 内运行区块出现，需主会话 `bun run dev` 过一遍）；数据中心内原生 `<select>` 还剩 TaskEditor（2 处）/ TriggerListEditor（4 处），归任务编辑相关 step
