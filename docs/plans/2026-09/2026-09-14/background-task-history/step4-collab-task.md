---
step: 4
title: 协作任务接入
status: pending
---

## 目标
协作任务（task-queue 执行会话）的执行流水进入统一历史：三处状态迁移各写一条，运行态注册。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 的 `RunHistorySource`、`background-activity-service`、`appendHistoryEntry` 带法
- 当前关键文件状态：
  - `electron/main/services/task-service.ts` — `interruptTask`（running→interrupted）、`rejectTask`（queued→rejected）、申报路径（running→review，函数名实施时确认，task-queue 注释称申报制结算入口）三处状态迁移
  - `electron/main/services/task-queue.ts` — `executeOne` 从 markTaskRunning 到轮结束；任务可能多轮（中断后用户续跑再申报），每轮申报各成一条历史
  - Task 结构：`id/title/status/result?/execSessionId?`
- 关键决策回顾：rejected → 历史 failed（summary 注明「被拒绝」）；不带 tokens；申报（→review）写 completed 且 summary = 申报的结果摘要（task.result）；挂 task-service 而非 task-queue 以覆盖手动取消等场景；写历史失败不影响状态迁移

## 计划改动
- [ ] `electron/main/services/task-queue.ts` — `markTaskRunning` 成功后 `reportRunning(task.id, { source: 'collab-task', name: 协作任务 · {title} })`；轮结束不结算（等子会话续跑）时不 reportDone；队列 safeInterrupt/safeReject/executeOne 收尾路径及申报路径各自 reportDone(task.id)——实施时以「running 态离开注册表」为不变量核对所有出口
- [ ] `electron/main/services/task-service.ts` — 三处迁移后写历史（try/catch）：
  - `interruptTask` → status 'interrupted'、error = 中断原因、startedAt 用 running 起点（Task 字段里有则用，无则省略）
  - `rejectTask` → status 'failed'、summary 首行「被拒绝」+ 原因
  - 申报路径（→review）→ status 'completed'、summary = 申报结果摘要
  - 三处统一 `source: 'collab-task'`、planName = `协作任务 · {title}`、triggerReason: 'condition'；reportRunning/reportDone 的调用点实施时按「历史与注册表同源同序」原则就近收口（可在 task-service 内做，也可 task-queue 侧做，取改动面小者，回填时写明）
- [ ] `bun run build:electron`；跑一个协作任务全流程（queued → 执行 → 申报 review），历史出现 completed 条目含申报摘要；手动中断场景出现 interrupted 条目

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
