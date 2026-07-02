---
step: 3
title: DigestsPanel UI 重构
status: done
---

## 目标
DigestsPanel 移除「刷新」按钮；标题区放「停止」「重新开始」两个按钮；移除 inline 停止；list 自动随轮询刷新；改 handleReDigest 提示文案。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2] `client.cancelAllGroupDigest()` 可用，返回 `{ success, cancelledQueued, cancelledCurrent } | { error }`
- 当前关键文件状态：`DigestsPanel.tsx` ~310 行
- 关键决策回顾：用户期望「停止」= 停止 worker 运行（清队列 + 取消当前），「重新开始」= 手动触发一次提炼

## 计划改动
- [x] import 加 `RotateCcw` from 'lucide-react'
- [x] 轮询逻辑：每次同时拉 `getGroupDigestActivity` + `listGroupDigests`（Promise.all），dependency 加 workspaceId
- [x] 加 `handleStopAll`：调 `cancelAllGroupDigest`，confirm 提示「清空待跑队列 N 个，并取消当前任务」
- [x] 加 `handleRestart`：调 `triggerGroupDigestScan` + `loadList`
- [x] 移除「刷新」按钮，换成「停止」「重新开始」两个按钮
- [x] 移除 inline 「停止」按钮（保留「正在提炼组 X」文字、queueDepth badge、lastScan 显示）
- [x] 修改 `handleReDigest` 描述：「列表会自动刷新」
- [x] 清理 dead code：`handleCancelDigest`、`loading` state（无 UI 引用了）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 清理了 dead code（`handleCancelDigest` 函数 + `loading` state），原计划没列但符合「不留半成品」原则
  - `loadList` 内部移除 try/finally，因为 setLoading 没了
- 改动文件清单：`app/settings/memory/DigestsPanel.tsx`

### 给下一步的接力棒
- 关键 UI 行为：
  - 启动应用 → activity 持久化数据立即显示（recent / lastScan 来自磁盘）
  - 「停止」禁用条件：`!activity.current && !(activity.queueDepth > 0)`
  - 「重新开始」总是可点击
  - list 随 2 秒轮询自动刷新（无需手动按钮）
- 待办或已知限制：

