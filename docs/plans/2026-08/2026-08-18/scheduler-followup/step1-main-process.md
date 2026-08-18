---
step: 1
title: 主进程——stopTask 链路 + on_task_done 引擎
status: done
---

## 目标

主进程具备：真停止能力（stopTask 分派 + review/categorize 补 cancelAll）、on_task_done 触发引擎（task_done 监听 + 环检测 + 引用校验）、tipc stopTask 路由。渲染层未动，本步完成后 IPC 可直接用 curl 级验证（编译 + 产物抽查）。

## 依赖上下文（接力棒输入）

- 设计文档：[scheduler-followup-design.md](./scheduler-followup-design.md) 改动三/改动四两节
- 当前关键签名（已核实，工具前缀改动未触碰）：
  - `plan-runner.ts`：`requestStop(taskId)` 现为日志型 no-op；`RunningInfo = { taskId, taskName, startedAt }`；`executeSingleTask` 里 `executeTask(task)` 无 hooks
  - `task-executor.ts`：`executeTask(task): Promise<TaskExecResult>`；`runCustomTask` 内生成 `agentTask.id = \`custom-agent-${task.id}-${Date.now()}\`` 后 `getAgentManager().submitTask(agentTask, cb)`
  - `review-trigger.ts`：模块级 `queue: StaleWorkspace[]` + `inFlight: Set` + `pumping` 泵；`current: { workspaceId, startedAt, taskId } | null`；已有 cancel 能力仅靠外部 `getAgentManager().cancelTask(current.taskId)`
  - `category-trigger.ts`：模块级 `queue: CategorizeJob[]` + `currentTaskId`；已有 `cancelCurrent()` / `cancelCategorizeOrganize()`
  - `group-digest-trigger.ts:294`：`cancelAllGroupDigest(): Promise<{ cancelledQueued, cancelledCurrent }>` 完整可用
  - `agent-manager.ts:167`：`cancelTask(taskId)`（队列移除或通知 worker cancel）
  - `scheduler-service.ts`：`init()` 里无 runner 事件监听；`fireTask(taskId, opts)` 已有；`tipc/scheduler.ts` 现 10 路由
  - `plan-validate.ts`：`validateTaskForSave(task, { workspaceIds })`；`time-rule-engine.ts`：`describeTrigger(trigger)` / `validateTrigger(trigger)`
  - `scheduler/types.ts` Trigger 现有 7 种变体

## 计划改动

- [x] `scheduler/types.ts`：Trigger 联合加 `{ id: string; type: 'on_task_done'; taskId: string }`
- [x] `memory/review-trigger.ts`：新增 `export function cancelAllReview(): { cancelledQueued: number; cancelledCurrent: boolean }`——清空 `queue`（同步清 inFlight 对应项视实现定，注意 pump 循环取 `queue.shift()`，清数组后自然结束）+ current 存在时 `getAgentManager().cancelTask(current.taskId)`
- [x] `memory/category-trigger.ts`：新增 `export function cancelAllCategorize(): { cancelledQueued: number; cancelledCurrent: boolean }`——清 `queue` + 调既有 `cancelCurrent()`；organize 类型 job 也在同一队列，整清符合「停止任务」语义
- [x] `runtime/task-executor.ts`：`executeTask(task, hooks?: { onAgentTaskId?: (id: string) => void })`；`runCustomTask` 生成 agentTask.id 后、submitTask 前调 `hooks?.onAgentTaskId?.(id)`；builtin 分支忽略 hooks
- [x] `runtime/plan-runner.ts`：
  - `RunningInfo` 加 `task: ScheduledTask`、`agentTaskId?: string`、`stopRequested: boolean`
  - `executeSingleTask` 把 `info` 传 hooks 上报 agentTaskId；executeTask 返回后若 `info.stopRequested` 且 `res.status === 'completed'`，`res.summary` 追加「（已被手动停止）」
  - `requestStop(taskId)` 真实现：置 `info.stopRequested = true` 后按分派——custom → `getAgentManager().cancelTask(info.agentTaskId)`（无 id 则跳过）；builtin group_digest → `cancelAllGroupDigest()`；review → `cancelAllReview()`；categorize → `cancelAllCategorize()`；categorize_organize → `cancelCategorizeOrganize()`（异步调用 void 化，不阻塞）
- [x] `scheduler-service.ts`：
  - `init()` 里 `this.runner.on('task_done', ...)`：outcome === 'completed' 时 `loadTasks()` 遍历，对每个含 `on_task_done` 且 `taskId === 事件.taskId` 的启用任务 `fireTask(下游.id, { triggerReason: 'condition', triggerDesc: \`任务「${上游.name}」完成后\` })`；异常 catch 记日志不抛
  - 新增 `stopTask(taskId): { ok: boolean; error?: string }`——不校验 running（requestStop 自身幂等，未运行返回 ok: true）
- [x] `tipc/scheduler.ts`：加 `stopTask: t.procedure.input<{ taskId: string }>()` → `getSchedulerService().stopTask(input.taskId)`，catch 返回 `{ ok: false, error }`
- [x] `time-rule-engine.ts`：`describeTrigger(trigger, taskNameOf?: (taskId: string) => string | undefined)` 加 on_task_done 分支（有名字显示 `任务「X」完成后`，无名显示 `任务完成后`）；`validateTrigger` 加分支校验 taskId 非空
- [x] `plan-validate.ts`：`validateTaskForSave` 加——① on_task_done.taskId 引用校验（ctx 需扩展现有任务集：调用点在 tipc saveTask，那里已有 existing 全量，把 `allTaskIds: Set<string>` 传入 ctx）；② 环检测 `detectTaskCycle`：从被保存任务的 on_task_done 边出发 DFS 现有任务集（保存语境=替换该任务后闭包判定），命中环返回 `'任务链触发不能构成循环'`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - **outcome 收紧**：`res.status === 'completed' && !info.stopRequested` 才算 completed，被停止的运行（手动 stop / window 到期）不触发 on_task_done 下游——计划字面映射会让 cancelled 也触发下游，与「停止」语义相悖，主会话验收采纳
  - `TaskSaveContext` 用 `allTasks: ScheduledTask[]` 而非 `allTaskIds: Set<string>`（环检测 DFS 需要全量边表，id 集现场派生）
  - cancelAllReview / cancelAllCategorize 额外 `inFlight.clear()`（入队去重集不清会永久泄漏 workspaceId 再入队）
  - fireTaskDoneDownstream 运行期跳过自引用（`task.id === upstreamId`），作为 saveTask 环检测之外的兕底
- 改动文件清单：`scheduler/types.ts`、`memory/review-trigger.ts`、`memory/category-trigger.ts`、`runtime/task-executor.ts`、`runtime/plan-runner.ts`、`scheduler-service.ts`、`tipc/scheduler.ts`、`time-rule-engine.ts`、`plan-validate.ts`（共 9 文件，严格 step 范围内）
- 验证：lint 0 errors / 74 warnings（基线一致）；build:electron 通过；dist 产物抽查齐全

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `client.stopTask({ taskId }) → { ok, error? }`（tipc 第 11 条路由）
  - Trigger 新变体 `{ id: string; type: 'on_task_done'; taskId: string }`——渲染层 `types/scheduler.ts` 需同步（Step 2 范围）
  - `describeTrigger(trigger, taskNameOf?: (taskId) => string | undefined)` 新签名——渲染层 `utils.ts` 同名函数需同步（Step 2 范围）
  - 校验文案：`任务链触发不能构成循环` / `触发器 N: 目标任务不存在` / `触发器 N: 缺少目标任务`
  - 历史：custom 停止 → status `cancelled`；builtin 停止 → `completed` + summary 尾缀「（已被手动停止）」（cancelled 已在 RunHistoryStatus 里，前端无需适配）
  - `getSchedulerActivity` 返回结构未变，前端按 running 切换「运行/停止」按钮即可
- 下个 step 该从哪里继续：scheduler-store 加 stopTask 方法 + SchedulerPanel 停止按钮 + TriggerListEditor 加 on_task_done 选项 + 内置任务模型选择三组接线
- 待办或已知限制：requestStop 与 agent 提交间有极小竞态窗口（custom 尚未拿到 agentTaskId 时请求停止会跳过 cancel，任务跑完仍标「已被手动停止」），与既有 group-digest cancelAll 竞态特征一致，未额外处理
