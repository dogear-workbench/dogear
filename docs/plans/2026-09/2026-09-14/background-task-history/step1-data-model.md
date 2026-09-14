---
step: 1
title: 数据层与统一活动注册表
status: done
---

## 目标
RunHistoryEntry 加 source 字段、queryHistory 支持类型筛选、新建统一活动注册表并把 scheduler 侧（定时任务）接入，完成后定时任务历史照常工作且条目带 source、运行态从注册表读。

## 依赖上下文（接力棒输入）
- 无前置 step。设计文档：`docs/plans/2026-09/2026-09-14/background-task-history-design.md`
- 当前关键文件状态：
  - `electron/main/services/scheduler/types.ts` 的 `RunHistoryEntry`（无 source 字段）
  - `electron/main/services/scheduler/run-history-store.ts` 的 `queryHistory(query: HistoryQuery)`（planId/before/limit 三参数）
  - `electron/main/services/scheduler/runtime/plan-runner.ts` 的 `appendTaskEntry/appendInterruptedEntry` 写历史；`RunningInfo` 内存 Map 维护运行态
  - `electron/main/services/scheduler/scheduler-service.ts:214` 写 missed 条目；`getActivity()` 聚合 taskRunner.getActivity()
  - `electron/main/tipc/scheduler.ts:119` listRunHistory、`:127` getSchedulerActivity
- 关键决策回顾：旧 JSONL 无 source 缺省 'scheduler'；planName 字段名不动；先写历史再 reportDone

## 计划改动
- [ ] `electron/main/services/scheduler/types.ts` — 加 `export type RunHistorySource = 'scheduler' | 'state-extract' | 'parse-article' | 'collab-task'`；`RunHistoryEntry` 加 `source?: RunHistorySource`（可选，兼容旧数据）；`SchedulerRunningPlan` 加 `source: RunHistorySource`
- [ ] 新建 `electron/main/services/background-activity-service.ts` — 内存单例：`reportRunning(key, { source, name })` / `reportDone(key)` / `getRunning(): SchedulerRunningPlan[]`（含 startedAt）
- [ ] `electron/main/services/scheduler/run-history-store.ts` — `HistoryQuery` 加 `source?: RunHistorySource`；筛选时 scheduler 匹配「有 source=scheduler」或「无 source 字段」，其余精确匹配
- [ ] `electron/main/services/scheduler/runtime/plan-runner.ts` — `appendTaskEntry`/`appendInterruptedEntry` 条目带 `source: 'scheduler'`；`runTask` 开始执行时 `reportRunning(task.id, { source: 'scheduler', name: task.name })`，executeSingleTask finally 里 `reportDone(task.id)`
- [ ] `electron/main/services/scheduler/scheduler-service.ts` — missed 条目带 `source: 'scheduler'`；`getActivity()` 的 running 改读 `getRunning()`（lastTickAt 语义保留）
- [ ] `electron/main/tipc/scheduler.ts` — `listRunHistory` input 加 `source?: string` 透传 queryHistory
- [ ] `types/scheduler.ts`（渲染层镜像）— 同步 RunHistorySource、RunHistoryEntry.source、SchedulerRunningPlan.source
- [ ] `bun run build:electron` 编译通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. plan-runner 删除了 `getActivity()` 方法（运行态改读统一注册表后无调用方，不留死代码）；`RunningInfo` 顺带清理无引用字段（taskId/startedAt/task，保留 taskName 供 requestStop 日志用）
  2. `appendTaskEntry` 外包 try/catch + log（落实「写历史失败不影响任务本身」：原实现失败会跳过 runState 清理且 outcome 误置 failed）；`appendInterruptedEntry` 保持原外层 catch 兼底（补记失败下次续跑重试是合理行为）
  3. tipc `listRunHistory` 的 source 参数类型用 `RunHistorySource` 而非裸 string（wire 上同为 string，渲染层传字面量兼容；step5 预期的 `source?: string` 不受影响）
  4. `reportRunning` 放在 executeSingleTask 内、interrupted 补记之后（当前架构 runTask 同步即执行无排队，此位置精确对应「真正开始执行时」）
- 改动文件清单：
  - `electron/main/services/scheduler/types.ts` — 新增 `RunHistorySource`；`RunHistoryEntry.source?: RunHistorySource`；`SchedulerRunningPlan.source: RunHistorySource`（必填）
  - `electron/main/services/background-activity-service.ts` — 新建，模块级内存单例
  - `electron/main/services/scheduler/run-history-store.ts` — `HistoryQuery.source?`；筛选用 `entry.source ?? 'scheduler'` 归一化精确匹配
  - `electron/main/services/scheduler/runtime/plan-runner.ts` — 三处写历史条目带 `source: 'scheduler'`；运行态接入注册表；删 getActivity
  - `electron/main/services/scheduler/scheduler-service.ts` — missed 条目带 source；`getActivity()` = `{ running: getRunning(), lastTickAt }`
  - `electron/main/tipc/scheduler.ts` — listRunHistory input 加 `source?: RunHistorySource` 透传
  - `types/scheduler.ts` — 渲染层镜像同步三处类型
- 验证：`bun run build:electron` 通过；渲染层 `tsc --noEmit` 通过；lint 零新增告警

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `RunHistorySource = 'scheduler' | 'state-extract' | 'parse-article' | 'collab-task'`（定义于主/渲染两侧 types/scheduler.ts，手工镜像）
  - `reportRunning(key, { source: RunHistorySource; name: string })` / `reportDone(key)` / `getRunning(): SchedulerRunningPlan[]`（key 用任务自身 id；`SchedulerRunningPlan = { taskId; taskName; source; startedAt }`，字段名沿用 taskId/taskName 不改）
  - 接入模板（参照 plan-runner.executeSingleTask）：任务开始执行时 `reportRunning(id, { source, name })` → 终态组装 `RunHistoryEntry`（source/planName=任务名/summary=结果/error/tokens 按口径）→ `await appendHistoryEntry(entry)`（try/catch + log）→ `reportDone(id)`
  - `queryHistory({ source? })`：旧 JSONL 无 source 条目在筛选时自动归为 scheduler，后续 step 无需迁移
- 下个 step 该从哪里继续：按 plan.md 顺序，state-extract 接入（`services/memory/state-extract-trigger.ts` + `agents/agent-worker.ts` 补 usage 返回）
- 待办或已知限制：注册表为纯内存态，重启即清（与设计一致）；渲染层 store/HistoryPanel 尚未消费 source 筛选（step5 范围）
