---
step: 2
title: 运行历史存储 + 计划执行器
status: pending
---

## 目标

实现 run-history 存储（按月 JSONL）与 plan-runner（计划内串行消费、断点持久化、窗口停机、防重入、完成事件），内置任务接通现有 trigger 层。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 的 types.ts / plan-store.ts；关键签名以实施回填为准
- 现有 trigger 层入口：`electron/main/services/memory/group-digest-trigger.ts`（`triggerScanAll` / `whenGroupDigestIdle`）、`review-trigger.ts`（`triggerReviewScan`）、`category-trigger.ts`（`triggerFullRebuild`；CATEGORIZE_ORGANIZE 对应入口执行时查 `agent-worker.ts` 现有 handler 与设置页调用点，缺单工作区参数的先加可选参数）
- agent-manager 提交任务：`getAgentManager().submitTask(...)` 签名执行时看 `agent-manager.ts`；本 step 只做 CUSTOM_AGENT 的 dispatch 占位（真正的 handler 在 step3），占位 = 提交任务并等待结果（agent-worker 尚无 handler 会返回 error，属预期，不要留 try/catch 空 stub——直接让错误走 failed 历史条目）
- 关键决策回顾：任务完成时写完整历史条目（运行中状态不落历史）；断点每次任务切换落盘；窗口停机 = 跑完当前不派发；防重入忽略新触发

## 计划改动

- [ ] 新建 `electron/main/services/scheduler/run-history-store.ts`：
  - `appendHistoryEntry(entry: RunHistoryEntry)` — 写 `<configDir>/run-history/YYYY-MM.jsonl`（本地时间取月份）
  - `queryHistory({ planId?, before?: number, limit = 50 }): { entries: RunHistoryEntry[], nextCursor?: number }` — 倒序（ts 降序）分页，跨月文件合并读
  - `cleanupHistory()` — 启动时调一次，删 3 个月前的月文件
- [ ] 新建 `electron/main/services/scheduler/runtime/plan-runner.ts`：
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
- [ ] trigger 层小改：`triggerScanAll(workspaceId?: string)` / `triggerReviewScan(workspaceId?: string)` 加可选参数（缺省维持全工作区行为，过滤 dirty 扫描范围）；category 同理若入口支持

## 验证

- `bun run build:electron` 通过
- 临时脚本：造一个 `[group_digest, review]` 的计划手动 `runPlan`，确认：历史文件出现两条 task 条目、plans.json 的 runState 正确清空、重复 runPlan 防重入生效、runPlan 期间 requestStop 后第二个任务不再派发且 runState 残留 pendingTasks
- 断点续跑：残留 pendingTasks 的计划再次 runPlan 只跑剩余任务

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
