---
step: 4
title: 协作任务接入
status: done
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
  - reportDone 收口点选在 task-service 层（计划允许二选一）：申报路径由 agents/tools/task-tools.ts 调用、手动取消由 tipc/tasks.ts 调用，队列侧均覆盖不到，task-service 是唯一能覆盖所有出口的层；reportRunning 按计划留在 task-queue（markTaskRunning 后，唯一调用方）。任务名统一由 task-service.collabTaskName 导出，两侧共用
  - 「running 态离开注册表」不变量核对后，除计划三处外还给两个出口补了 reportDone：cancelTask（queued/running→backlog 手动取消）与 completeTask（running→review，当前无调用方的遗留导出，防未来启用时泄漏）；recoverInterruptedTasks（启动恢复）不处理——注册表内存态重启已空，天然闭合
  - reportTaskResult 按「任何成功迁移到 review 的申报都写历史」实现（计划改动段写的是「→review」）：覆盖 running→review 常规路径与 interrupted/rejected→review 插话续跑路径，后者 startedAt 从注册表查不到自然省略，与「每轮申报各成一条历史」语义一致
- 改动文件清单：
  - `electron/main/services/task-service.ts` — 新增 collabTaskName 导出 + recordCollabRun（写历史 try/catch + reportDone，先历史后 reportDone）；interruptTask/rejectTask/reportTaskResult 三处迁移后 `void recordCollabRun(...)`；cancelTask/completeTask 补 reportDone
  - `electron/main/services/task-queue.ts` — markTaskRunning 成功后 reportRunning(task.id, { source: 'collab-task', name })

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `collabTaskName(task: Pick<Task, 'title'>): string` → `协作任务 · {title}`
  - `recordCollabRun(task, status: RunHistoryStatus, summary?, error?)` 私有：条目 source 'collab-task' / kind 'task' / triggerReason 'condition' / startedAt=注册表查询（无则省略）/ endedAt=now / 无 tokens
  - 状态映射：申报→completed（summary=task.result）；interruptTask→interrupted（error=task.result 即中断原因，summary 省略）；rejectTask→failed（summary=`被拒绝：${reason}`）
- 下个 step 该从哪里继续：Step 5 执行历史 UI（history-utils SOURCE_META 四类标签/徽章、history-panel 类型筛选 + 运行区统一注册表数据源）
- 待办或已知限制：
  - 手动取消（cancelTask）不写历史（计划三处不含），仅收口注册表；如需 cancelled 流水可后续补
  - 运行时验证跳过（协作任务全流程无法无人值守执行），以编译 + running 态出口全量走查代替
  - 日志用 mainLogger.child('task-service')，写历史/清注册表失败 warn 不影响迁移
