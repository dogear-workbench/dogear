---
step: 5
title: focusTask 通知分流
status: done
---

## 目标

任务通知点击跨窗口路由：笔记窗口打开 → 聚焦笔记窗口 + notesTaskFocus 广播定位任务；未打开 → 走现状（主窗口切笔记 tab）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-main-infra.md] notesTaskFocus 事件已定义、getNotesWindowOpen RPC 已有；[step3-tabbar-notes-window.md] 笔记窗口页面已监听 notesTaskFocus 并定位
- 当前关键文件状态：
  - `focusTask` 事件由主进程通知链路发出（先 Grep 定位发送点：notification-center-service.ts 或 tipc/notifications.ts / tipc/agent.ts 的通知点击处理）
  - `app/page.tsx` focusTask 监听（现状：切工作区 + switchTab(NOTES_TAB_ID) + requestTaskFocus）
- 关键决策回顾：分流判断在主进程做（方案 A）；笔记窗口不在时主窗口行为保持现状不变；定位目标任务不在当前工作区时一期只按 taskId 定位，找不到 toast

## 计划改动

- [ ] 定位 focusTask 发送点，在发送前分流：`getNotesWindowOpen()`（或主进程内直接查 notesWindow 变量，优先进程内直查）为 true → notesWindow.focus() + 广播 notesTaskFocus；false → 原样发 focusTask
- [ ] `app/page.tsx` focusTask 分支兼容：笔记 tab 可能被关（notesTabOpen=false）或弹出中——switchTab 前确保 notesTabOpen && !notesWindowOpen（照数据中心 openDataCenterTab 的「不存在则挂载」写法）
- [ ] 验证：双开（主窗口 + 笔记窗口）时点任务通知 → 笔记窗口前置并定位任务；笔记窗口不开时点通知 → 主窗口切笔记 tab 定位（现状不回归）；笔记 tab 被关掉时点通知 → tab 自动重开并定位

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 渲染层 `app/page.tsx` focusTask 分支**零改动**：switchTab 收口（Step 3）已覆盖计划要求的「notesTabOpen && !notesWindowOpen 前置判断」——分流后主窗口只在笔记窗口不存活时收到 focusTask（不存在弹出中场景），笔记 tab 被关时 switchTab(NOTES_TAB_ID) 自动重开。重复加判断属双重逻辑。
  2. Step 4 遗留修复弃用「主进程补发广播」建议：新窗口 loadURL 返回时渲染层监听未注册、did-finish-load 时 React useEffect 也未必注册完，补发有竞态。改用「冷启动查询」：新增 RPC `getWorkbenchWindowOpen`，session-window 初始化时拉取（项目先例：workbench-window 冷启动 getFocusedConversation 拉取，「初始状态查询、变更事件」模式），无竞态。
- 改动文件清单：
  - `electron/main/main-app.ts`：setLocateCallback 的 taskId 分支抽出 `routeFocusTask()` 分流（getNotesWindow 进程内直查 → restore+focus + 直发 notesTaskFocus，发送失败静默；不存活 → 主窗口发 focusTask 现状）；新增导出 `getWorkbenchWindowOpen(): boolean`
  - `electron/main/tipc/windows.ts`：新增 RPC `getWorkbenchWindowOpen → { open: boolean }`
  - `app/session-window/page.tsx`：init effect 内冷启动拉取互斥态（fire-and-forget，失败静默）
- 验证：build:electron / lint（0 errors）/ tsc --noEmit 全过；UI 链路待 dev 人工确认（双开点通知→笔记窗口前置定位；不开→主窗口切笔记 tab；tab 被关→自动重开定位）

### 给下一步的接力棒
- 关键签名：`routeFocusTask(taskId, workspaceId)`（main-app.ts 模块私有）；`client.getWorkbenchWindowOpen() → { open }`；发送点唯一（setLocateCallback），通知中心渲染层点击不在此链路
- 下个 step：无（计划收官）
- 待办或已知限制：通知中心点击在笔记窗口弹出中走 switchTab 收口「落回最近可用 tab」，不路由笔记窗口（渲染层路径，一期范围外）；本计划遗留见各 step 交付文档
