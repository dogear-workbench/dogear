---
step: 5
title: focusTask 通知分流
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
