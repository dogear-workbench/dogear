---
step: 2
title: 申报工具与队列加固
status: pending
---

## 目标

新增 `dogear__ReportTaskResult` 工具，执行提示词加申报约定；队列删心跳、防卡死强制放行、写回防双写、丢弃留痕、safeInterrupt 分流，启动恢复改用 interruptTask。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-store.md] task-store 已有 `interruptTask(workspacePath, taskId, reason)`、`reportTaskResult(workspacePath, execSessionId, result)`（原子迁移 review）、`recoverInterruptedTasks(workspacePath)`（running→interrupted 无条件）；touchRunningTask 已删除
- 当前关键文件状态：`electron/main/services/task-queue.ts` 的 `runExecutionTurn`（await sendMessage + once('complete') + idleTimer 2h 熔断）、`executeOne` 写回段（getTask 重查 → completeTask → notify）、`safeReject`、`recoverAndStartTaskQueue`（12min 复查 setTimeout）；`electron/main/agents/tools/task-tools.ts` 的 `createTaskToolDefs(workspacePath, sourceContext)` 挂 dogear-tasks 组
- 关键决策回顾：队列兜底写回前先查状态防双写；markTaskRunning 之后的意外中断走 interrupted（safeInterrupt），之前的确定性拒绝仍走 safeReject/rejected

## 计划改动

- [ ] `electron/main/agents/tools/task-tools.ts` 新增第四个工具 `dogear__ReportTaskResult`：
  - description：申报任务执行结果（仅任务执行会话可用）。参数 zod：`result: z.string().min(1)`（结果摘要：做了什么、关键改动位置、遗留问题）
  - handler：`taskService.reportTaskResult(workspacePath, sourceContext.conversationId, result)`；null → errorResult「当前会话不是任何待回写任务（running/interrupted/rejected）的执行会话」；成功 → textResult 确认 + 提醒任务已进待审核
- [ ] `electron/main/services/task-queue.ts` `buildExecutionPrompt`：执行要求第 3 条改为「整个计划实施完成后，调用 dogear__ReportTaskResult 工具申报结果摘要（做了什么、关键改动位置、遗留问题），任务将进入待审核；同时在回复末尾输出 <task-result></task-result> 标签段作为备用信号」
- [ ] `runExecutionTurn` 删心跳：`TASK_TOUCH_INTERVAL_MS` / `lastTouchMs` / `maybeTouchHeartbeat` 及 onMessage 里的调用
- [ ] `runExecutionTurn` 防卡死强制放行：sendMessage 包 `Promise.race`——fireIdleTimeout 时先 `void session.interrupt()`，再起 60s 二级定时器向 race 注入放行信号；放行胜出时 turnResult 置 `{ subtype: 'cancelled', error: { kind: 'runtime', message: '执行会话长时间无响应，已强制解锁队列' } }`（subtype 枚举以 PiSessionTurnResult 实际类型为准，实施时对齐）；已累积 text 保留供摘要提取
- [ ] `executeOne` 写回段：outcome 非 success 时不再 safeReject，改 `safeInterrupt(ctx, reason)`（见下）；提取 summary 后 getTask 重查——`review` → log.info 跳过（已被申报）；`running` → completeTask + notify（现状）；其他状态（backlog 等被取消）→ **留痕**：log.warn + `taskService.appendResultNote`（若无此方法则在 rejected/丢弃分支把摘要拼进 result，实施时选最小改法）+ notify「任务结果已产出但任务已被 X，摘要见任务详情」
- [ ] 新增 `safeInterrupt(ctx, reason)`：对照 safeReject，from `['running']` → interruptTask + log.warn 落盘 + notify（标题「任务已中断：xxx」，body 带 plan.md「全局决策」的引导句）
- [ ] `safeReject` 收窄语义：仅剩 markTaskRunning 之前的调用点（plan 缺失 / 无 origin / 无组 / 建会话失败 / markTaskRunning 失败）——检查现有调用点逐一归类，markTaskRunning 之后的全部换 safeInterrupt
- [ ] `recoverAndStartTaskQueue`：删 `RECOVER_RECHECK_DELAY_MS` 与 12min 复查 setTimeout；恢复调用改 task-service 新签名（recovered 数量日志保留）；对每个恢复任务 notify 中断通知（带引导句）；末尾 kick() 保留
- [ ] `electron/main/tipc/tasks.ts` 检查：`cancelCollabTask` / `executeCollabTask` 等路由对 interrupted 状态的兼容（executeTask from 已放宽则透传即可，无需新路由）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
