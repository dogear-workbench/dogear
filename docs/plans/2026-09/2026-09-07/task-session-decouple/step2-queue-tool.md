---
step: 2
title: 申报工具与队列加固
status: done
---

## 目标

新增 `dogear__ReportTaskResult` 工具，执行提示词加申报约定；队列删心跳、防卡死强制放行、写回防双写、丢弃留痕、safeInterrupt 分流，启动恢复改用 interruptTask。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-store.md] task-store 已有 `interruptTask(workspacePath, taskId, reason)`、`reportTaskResult(workspacePath, execSessionId, result)`（原子迁移 review）、`recoverInterruptedTasks(workspacePath)`（running→interrupted 无条件）；touchRunningTask 已删除
- 当前关键文件状态：`electron/main/services/task-queue.ts` 的 `runExecutionTurn`（await sendMessage + once('complete') + idleTimer 2h 熔断）、`executeOne` 写回段（getTask 重查 → completeTask → notify）、`safeReject`、`recoverAndStartTaskQueue`（12min 复查 setTimeout）；`electron/main/agents/tools/task-tools.ts` 的 `createTaskToolDefs(workspacePath, sourceContext)` 挂 dogear-tasks 组
- 关键决策回顾：队列兜底写回前先查状态防双写；markTaskRunning 之后的意外中断走 interrupted（safeInterrupt），之前的确定性拒绝仍走 safeReject/rejected

## 计划改动

- [x] `electron/main/agents/tools/task-tools.ts` 新增第四个工具 `dogear__ReportTaskResult`：
  - description：申报任务执行结果（仅任务执行会话可用）。参数 zod：`result: z.string().min(1)`（结果摘要：做了什么、关键改动位置、遗留问题）
  - handler：`taskService.reportTaskResult(workspacePath, sourceContext.conversationId, result)`；null → errorResult「当前会话不是任何待回写任务（running/interrupted/rejected）的执行会话」；成功 → textResult 确认 + 提醒任务已进待审核
- [x] `electron/main/services/task-queue.ts` `buildExecutionPrompt`：执行要求第 3 条改为「整个计划实施完成后，调用 dogear__ReportTaskResult 工具申报结果摘要（做了什么、关键改动位置、遗留问题），任务将进入待审核；同时在回复末尾输出 <task-result></task-result> 标签段作为备用信号」
- [ ] `runExecutionTurn` 删心跳：`TASK_TOUCH_INTERVAL_MS` / `lastTouchMs` / `maybeTouchHeartbeat` 及 onMessage 里的调用
- [x] `runExecutionTurn` 防卡死强制放行：sendMessage 包 `Promise.race`——fireIdleTimeout 时先 `void session.interrupt()`，再起 60s 二级定时器向 race 注入放行信号；放行胜出时 turnResult 置 `{ subtype: 'cancelled', error: { kind: 'runtime', message: '执行会话长时间无响应，已强制解锁队列' } }`；已累积 text 保留供摘要提取
- [x] `executeOne` 写回段：outcome 非 success 时不再 safeReject，改 `safeInterrupt(ctx, reason)`（见下）；提取 summary 后 getTask 重查——`review` → log.info 跳过（已被申报）；`running` → completeTask + notify（现状）；其他状态（backlog 等被取消）→ **留痕**：log.warn + `taskService.appendResultNote`（新增 store 原语，最小改法）+ notify「任务结果已产出但任务已被 X，摘要见任务详情」
- [x] 新增 `safeInterrupt(ctx, reason)`：对照 safeReject，from `['running']` → interruptTask + log.warn 落盘 + notify（标题「任务已中断：xxx」，body 带 plan.md「全局决策」的引导句）
- [x] `safeReject` 收窄语义：仅剩 markTaskRunning 之前的调用点（plan 缺失 / 无 origin / 无组 / 建会话失败 / markTaskRunning 失败）——markTaskRunning 之后的调用点（attach 失败 / session 拉起失败 / 执行轮非 success）已全部换 safeInterrupt，drain 兑底 catch 改为按当前状态分流
- [x] `recoverAndStartTaskQueue`：恢复调用走 task-service 新签名（返回 recoveredTasks 供通知），对每个恢复任务 notify 中断通知（带引导句，逐任务不合并）；末尾 kick() 保留
- [x] `electron/main/tipc/tasks.ts` 检查：零改动确认——executeTask/completeTaskManually/moveTaskToPlan 的 from 已含 interrupted（step1），moveTaskToBacklog/cancelCollabTask 对 interrupted 报错属迁移表预期语义，透传即可

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `appendResultNote` 落在 task-store（mutateTasks 原语）+ task-service 广播透传：摘要必须落盘（通知指向任务详情），这是计划预留的「最小改法」选项
  2. `dogear__ListTasks` status 枚举与 description 补 `interrupted`（计划外配套）：申报约定要求执行会话能感知/查询中断任务，枚举不补会 zod 校验失败；纯主进程工具层
  3. `recoverInterruptedTasks` 返回值扩展 `recoveredTasks: Task[]`（计划外最小扩展）：逐任务通知需要任务数据，事后 listTasks 无法区分本次恢复与历史 interrupted；step1 测试解构不受影响（19 pass）
  4. drain 兑底 catch 改为按当前状态分流（running → safeInterrupt，否则 safeReject）：无法静态判断异常发生在 markTaskRunning 前后，运行时查状态最准确；markTaskRunning 失败仍 queued 自然归 safeReject，无需在 executeOne 加 try/catch
  5. 「已回写」提示在工具 handler 内做（store 返 null 后查 listTasks 复核 review/done），不污染 store 原子语义
  6. safeReject 调用点归类结果：markTaskRunning 前 6 处保留；attach 失败 / session 拉起失败 / 执行轮非 success 共 3 处换 safeInterrupt；notify 提成模块级 notifyTask + notifyTaskInterrupted（recoverAndStartTaskQueue 复用），通知文案带 REPORT_RESULT_HINT 引导句
- 改动文件清单：
  - `electron/main/agents/tools/task-tools.ts`（新增 dogear__ReportTaskResult；ListTasks 枚举补 interrupted）
  - `electron/main/services/task-queue.ts`（申报约定文案、防卡死强制放行 Promise.race、写回段重写、safeInterrupt、safeReject 收窄、恢复逐任务通知）
  - `electron/main/services/task-store.ts`（appendResultNote；recoverInterruptedTasks 返回 recoveredTasks）
  - `electron/main/services/task-service.ts`（透传 + 签名同步）
  - `electron/main/tipc/tasks.ts`：零改动（确认透传即可，详见共享区 step2-delivery.md）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `appendResultNote(workspacePath, taskId, note): Promise<Task | null>` — result 尾部追加 `[执行结果留痕 ISO时间] 摘要`，不改状态；note 空时用占位文案
  - `recoverInterruptedTasks(workspacePath): Promise<{ recovered: number; recoveredTasks: Task[] }>`
  - 强制放行 outcome：`{ subtype: 'cancelled', error: { kind: 'runtime', message: '执行会话长时间无响应，已强制解锁队列' } }`
- 下个 step 该从哪里继续：step3 前端 —— TaskPanel interrupted 并入 plan 组尾部（同 rejected 现状）+「已中断」徽标；详情页 interrupted 态操作（重新入队 / 移回计划 / 手动完成）+ 中断原因（result 字段，注意可能是申报摘要或带 `[执行结果留痕 …]` 前缀的拼接文本）；TaskStatusBadge 的 Record<TaskStatus,...> 补 interrupted key（step1 遗留的 tsc 报错点）
- 待办或已知限制：中断通知逐任务未合并（design.md 未决默认决策）；强制放行后 pi 会话自身可能仍挂死（仅解锁队列，交 orphan 保活收尾）；docs/codebase-map.md 描述过时待全链路后统一更新
