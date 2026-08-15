---
step: 2
title: 运行历史存储 + 计划执行器
status: done
---

## 目标

实现 run-history 存储（按月 JSONL）与 plan-runner（计划内串行消费、断点持久化、窗口停机、防重入、完成事件），内置任务接通现有 trigger 层。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 的 types.ts / plan-store.ts；关键签名以实施回填为准
- 现有 trigger 层入口：`electron/main/services/memory/group-digest-trigger.ts`（`triggerScanAll` / `whenGroupDigestIdle`）、`review-trigger.ts`（`triggerReviewScan`）、`category-trigger.ts`（`triggerFullRebuild`；CATEGORIZE_ORGANIZE 对应入口执行时查 `agent-worker.ts` 现有 handler 与设置页调用点，缺单工作区参数的先加可选参数）
- agent-manager 提交任务：`getAgentManager().submitTask(...)` 签名执行时看 `agent-manager.ts`；本 step 只做 CUSTOM_AGENT 的 dispatch 占位（真正的 handler 在 step3），占位 = 提交任务并等待结果（agent-worker 尚无 handler 会返回 error，属预期，不要留 try/catch 空 stub——直接让错误走 failed 历史条目）
- 关键决策回顾：任务完成时写完整历史条目（运行中状态不落历史）；断点每次任务切换落盘；窗口停机 = 跑完当前不派发；防重入忽略新触发

## 计划改动

- [x] 新建 `electron/main/services/scheduler/run-history-store.ts`：
  - `appendHistoryEntry(entry: RunHistoryEntry)` — 写 `<configDir>/run-history/YYYY-MM.jsonl`（本地时间取月份）
  - `queryHistory({ planId?, before?: number, limit = 50 }): { entries: RunHistoryEntry[], nextCursor?: number }` — 倒序（ts 降序）分页，跨月文件合并读
  - `cleanupHistory()` — 启动时调一次，删 3 个月前的月文件
- [x] 新建 `electron/main/services/scheduler/runtime/plan-runner.ts`：
  - 单例 `getPlanRunner()`，EventEmitter（`plan_done` 事件带 `{ planId, outcome }`，outcome = 'completed' | 'stopped' | 'failed'）
  - `runPlan(plan, opts: { triggerReason: 'time' | 'condition' | 'manual', triggerDesc?: string })`：
    - 防重入：`runningPlanIds` Set 已含 planId → 返回 `{ started: false }`
    - 入队：`plan.runState?.pendingTasks?.length ? 从断点续 : tasks 全量 taskId 队列`；runState.cursor 对应的任务若上次被中断，先补一条 `interrupted` 历史（对比 startedAt 记录，见下）
    - 逐任务执行：`executeTask(plan, task)` → 内置走 `runBuiltinTask`，自定义走 `runCustomTask`
    - 每任务完成 → appendHistoryEntry（status/summary/error/tokens）→ 更新 `pendingTasks` 并写 runState（cursor 置下一个或清空）
  - `runBuiltinTask(task, plan)` — switch builtinId：group_digest → `triggerScanAll(workspaceId?) + whenGroupDigestIdle()`；review → `triggerReviewScan(workspaceId?)`（返回/等待方式执行时对齐现有函数）；categorize → `triggerFullRebuild`；categorize_organize → 查现有入口接上；结束从 trigger 层 activity 或返回值取 outcome/摘要
  - `runCustomTask(task, plan)` — 组装 `CustomAgentTaskPayload` 提交 agent-manager，`awaitTask` 完成后从 result 提取 summary/tokens（结构对齐 step3 定义的 payload/result）
  - `requestStop(planId)` — 置 stopRequested 标记，当前任务结束后不再派发（不硬中断）；队列剩余存 runState；若内置任务正排在 trigger 层串行队列里，等待其自然完成
  - `interrupted` 标记：任务开始时把 `{ taskId, startedAt }` 记入 runState.cursor + startedAt 字段（类型加 `cursorStartedAt?: number`），任务完成时清除；下次 runPlan 启动时发现 cursorStartedAt 存在但任务无完成历史 → 补 interrupted 条目（简化实现：发现 cursorStartedAt 存在即补一条，幂等由 startedAt 时间戳区分）
  - `getActivity(): SchedulerActivity` — 正在运行的计划 + 当前任务快照
- [x] trigger 层小改：`triggerScanAll(workspaceId?: string)` / `triggerReviewScan(workspaceId?: string)` 加可选参数（缺省维持全工作区行为，过滤 dirty 扫描范围）；category 同理若入口支持

## 验证

- `bun run build:electron` 通过（实测通过）
- 临时脚本：造一个 `[group_digest, review]` 的计划手动 `runPlan`，确认：历史文件出现两条 task 条目、plans.json 的 runState 正确清空、重复 runPlan 防重入生效、runPlan 期间 requestStop 后第二个任务不再派发且 runState 残留 pendingTasks（实测全过，脚本已删）
- 断点续跑：残留 pendingTasks 的计划再次 runPlan 只跑剩余任务（实测通过；另验了 interrupted 补记、queryHistory 分页/过滤、cleanupHistory、自定义任务占位全链路 worker 报错 → failed）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 任务执行拆出 `runtime/task-executor.ts`（executeTask/runBuiltinTask/runCustomTask/taskDisplayName），plan-runner.ts 只留调度循环，两文件各 <200 行
  - review/categorize 无现成 idle 等待函数：未新增 whenXxxIdle，改为 task-executor 内轮询 activity（500ms，current===null && queueDepth===0）；group_digest 沿用现有 whenGroupDigestIdle
  - 自定义任务占位：提交 type='custom_agent'（本地常量 `CUSTOM_AGENT_TASK_TYPE = 'custom_agent' as TaskType`，未动 task-types.ts）给 agent-manager 并等待回调，worker 报「未知任务类型: custom_agent」→ failed 历史；工作区/模型缺失在本地返回明确 error（同样 failed）
  - runState 语义：pendingTasks 含 cursor（任务开始写 { pendingTasks: [当前+剩余], cursor, cursorStartedAt }，完成写 { pendingTasks: [剩余], cursor: 下一任务 }，队列耗尽清空）；断点判定为「runState 存在且 pendingTasks 是数组」（空数组→不跑并清空，防误全量重跑）；被中断的 cursor 任务补 interrupted 后会重跑（未完成即剩余）
  - plan outcome：有剩余未跑=stopped（优先）；跑完但含 failed 任务=failed
  - task-executor 对三个 trigger 模块用分支内 await import（对齐 trigger 层延迟导入惯例，也便于纯 bun 脚本测试）
- 改动文件清单：
  - 新增 `electron/main/services/scheduler/run-history-store.ts`
  - 新增 `electron/main/services/scheduler/runtime/plan-runner.ts`
  - 新增 `electron/main/services/scheduler/runtime/task-executor.ts`
  - 修改 `electron/main/services/scheduler/types.ts`（PlanRunState 加 cursorStartedAt?）
  - 修改 `types/scheduler.ts`（前端镜像同步）
  - 修改 `electron/main/services/memory/group-digest-scanner.ts`（scanAllWorkspaces 加可选 workspaceId 过滤）
  - 修改 `electron/main/services/memory/group-digest-trigger.ts`（triggerScanAll 加可选参数透传）
  - 修改 `electron/main/services/memory/review-scanner.ts`（findStaleWorkspaces 加可选 workspaceId 过滤）
  - 修改 `electron/main/services/memory/review-trigger.ts`（triggerReviewScan 加可选参数透传）
  - category-trigger 未改（triggerFullRebuild/triggerCategorizeOrganize 本就收 workspaceId，「全部工作区」由 executor 迭代）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `getPlanRunner().runPlan(plan, { triggerReason, triggerDesc? }): { started: boolean }`（异步起跑不阻塞；运行中重复调用返回 started:false 并记日志）
  - `getPlanRunner().requestStop(planId)`（只置标记，当前任务跑完停；未运行时 no-op）
  - `getPlanRunner().on('plan_done', (e: { planId: string; outcome: 'completed' | 'stopped' | 'failed' }) => ...)`
  - `getPlanRunner().getActivity(): SchedulerActivity`（lastTickAt 恒 0，step4 scheduler-service 覆盖）
  - `appendHistoryEntry(entry)` / `queryHistory({ planId?, before?, limit? }): { entries, nextCursor? }`（ts 降序，nextCursor=本页末条 ts，下次传 before）/ `cleanupHistory()`
  - `executeTask(task): TaskExecResult`（status/summary/error/tokens）；CUSTOM_AGENT 结果对齐 step3：`{ ok, summary, tokens?, error? }`，tokens 取 result.tokens ?? result.usage
  - taskDisplayName：builtin → 组卡提炼/复盘报告/智能分类/分类整理
- 下个 step 该从哪里继续：
  - step3：task-types.ts 加 `TaskType.CUSTOM_AGENT = 'custom_agent'` 后，删掉 task-executor 里的本地常量改用枚举；payload 接口已在 task-executor 本地定义（step3 迁到 task-types.ts）
  - step4：scheduler-service tick → runPlan/requestStop 接线；missed 条目用 appendHistoryEntry 写 kind:'missed'
- 待办或已知限制：
  - review/categorize 的「队列清空」用 activity 轮询（500ms 粒度），等待的是共享队列整体空闲（与手动按钮共用）
  - review 扫描失败被 triggerReviewScan 内部吞掉 → 历史记 completed（与设置页手动行为一致）
  - 断点里已删除的任务 id 跳过并记日志（不写历史条目）
  - run-history JSONL 未走 safe-json（append 场景，坏行读取时跳过）
