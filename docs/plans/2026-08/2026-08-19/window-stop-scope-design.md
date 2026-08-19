# window 触发器停机范围修正 设计

**背景**：定时任务的 `window` 触发器（如 03:00–05:00）在窗口外的每次 tick（60s）都会调 `requestStop(task.id)`，且不区分当前运行是谁触发的。用户任务上同时挂 `on_app_start` / `on_session_close` 时，这些来源启动的运行会在 60 秒内被掐掉：`cancelAllGroupDigest()` 清空提炼队列 → `whenGroupDigestIdle()` 立即返回 → 落历史 completed +「（已被手动停止）」误标文案。组卡实际没提炼，反复「发现 N 个组 → 被停」。运行历史实锤：所有被标停的记录 triggerDesc 均为「应用启动时 / 手动运行」，时间全在窗口外，且都在启动后约一个 tick 周期内。

**目标**：
1. window 关闭只停「由该 window 触发器启动的运行」；其他来源（daily_at / interval / once / on_app_start / on_session_close / on_task_done / 手动）的运行不受影响
2. summary 停止文案区分「手动停止」与「窗口超时自动停止」

**架构**（核心做法）：
- `RunTaskOptions` 加 `triggerId?: string`，`fireTask` 链路下发；`RunningInfo` 记 `sourceTriggerId`
- `requestStop(taskId, sourceTriggerId?)`：带 `sourceTriggerId` 时仅当 `RunningInfo.sourceTriggerId` 相等才停；不带（stopTask IPC）停任何运行
- `RunningInfo.stopReason: 'manual' | 'window'`：summary 尾缀分别为「（已被手动停止）」/「（已超出时间窗口，自动停止）」
- 排除的选项：window 关闭不再自动停（丢掉「过点不跑」语义）；仅按「来源是任意 window」匹配（多窗口挂同一任务时有歧义，triggerId 精确匹配成本相同）

**模块边界**：
- `electron/main/services/scheduler/runtime/plan-runner.ts`：RunningInfo / RunTaskOptions / requestStop / summary 拼接
- `electron/main/services/scheduler/scheduler-service.ts`：`evaluateTrigger` window 分支传 `trigger.id`；`fireTimeTrigger` 传各自 trigger.id；条件触发与 `runTaskManual` 不传
- tipc / 前端不动（stopTask 不带来源 = 停一切，现状语义）

**数据流**：window 开 → `fireTask(taskId, { triggerReason: 'time', triggerId: <window.id> })` → runner 记来源 → 窗口关 → tick `requestStop(task.id, trigger.id)` → 来源相等才置 stopRequested + stopReason='window' + cancelAll 分派 → executeTask 返回 → summary 追加窗口文案 → 历史落盘。白天 on_app_start 启动的运行 sourceTriggerId 为空 → requestStop 匹配失败 → 不停，自然跑完。

**错误处理 / 边界情况**：
- 同任务多来源并发不存在（runner 按 task.id 防重入），RunningInfo 单来源字段够用
- 被 window 超时停的运行 `outcome = failed`，**不触发 on_task_done 下游**（用户拍板：提炼跑一半不应触发智能分类，等干净完成再链）
- requestStop 与任务启动间的既有极小竞态窗口不变，不额外处理

**未决问题**：无。
