---
step: 1
title: 主进程模型迁移全链路
status: done
---

## 目标

主进程侧完成「计划→单任务」模型重构：类型重定义、plans.json 一次性迁移、内置任务 seed、单任务执行器、去链式、既有 7 个 IPC 路由适配。完成标志：`bun run build:electron` 编译通过，主进程在单任务模型下行为等价。

## 依赖上下文（接力棒输入）

- 设计文档：`../scheduler-single-task-redesign.md`
- 当前关键文件状态：
  - `electron/main/services/scheduler/types.ts`：旧 `Plan`/`PlanTask`/`PlanRunState`/`Trigger`（8 种含 on_plan_done）
  - `plan-store.ts`：`loadPlans/savePlans` 直读写 plans.json，`seedDefaultPlans` 只在文件不存在时播种旧「夜间维护」
  - `plan-runner.ts`：`executePlan` 按队列循环 `plan.tasks`，`resolveQueue` 消费 `runState.pendingTasks`
  - `plan-validate.ts`：`validatePlanForSave` 校验 tasks 数组 + `detectPlanCycle`（链式环检测，将整体删除）
  - `task-executor.ts`：`runCustomTask` 构造 `CustomAgentTaskPayload` 提交 agent-manager
  - `custom-agent-tools.ts`：`buildCustomToolSet(workspaceId, workspacePath, configDir)` 按工作区 enabledToolPacks 组装
  - `tipc/scheduler.ts`：7 个路由，命名见 plan.md 全局决策映射表
- 关键决策回顾：历史条目字段名不改（planId=任务 id）；seed 按 builtinId 幂等；迁移读时完成并回写 version:2

## 计划改动

### 1. `electron/main/services/scheduler/types.ts` — 类型重定义

- [ ] 按 plan.md 全局决策的新模型重写：`ScheduledTask`（Builtin/Custom 两变体）、`TaskRunState = { cursorStartedAt?: number }`、`Trigger` 删 `on_plan_done`、`SchedulerRunningPlan` 改 `{ taskId, taskName, startedAt }`
- [ ] `RunHistoryEntry` 字段保留不动（新条目不填 taskId/taskName）
- [ ] 导出 `ScheduledTaskWithNextRun = ScheduledTask & { nextRunAt?: number }`

### 2. `plan-store.ts` — 迁移 + seed

- [ ] `loadPlans`：读文件 → 探测旧格式（元素含 `tasks` 数组）→ 迁移映射（规则见 plan.md 全局决策「plans.json 迁移」）→ 回写 `version: 2` → seed → 返回
- [ ] 迁移映射中 builtin 任务显示名用 `BUILTIN_LABELS`（从 task-executor 的 `BUILTIN_LABELS` 提到共享位置或复制）
- [ ] `seedDefaultPlans` 重写：按 builtinId 查重幂等补建 4 条；`group_digest`/`review` 带夜间维护触发器且 enabled，另两条 disabled 无触发器；固定 id `builtin-${builtinId}`
- [ ] `updatePlanRunState` → `updateTaskRunState(taskId, runState | undefined)`
- [ ] `touchTriggerFired` / `markOnceFired` 签名不变（planId 参数语义 = taskId，参数名改 taskId）

### 3. `plan-validate.ts` — 重写校验

- [ ] `assignTaskIds(task)`：补 id/createdAt/updatedAt/triggers id
- [ ] `mergeFiredState` 保留逻辑（按 trigger id 合并 lastFiredAt/fired），入参改单任务；runState 合并删除（断点语义变化，编辑保存时丢弃旧 runState 即可）
- [ ] `validateTaskForSave(task, ctx)`：name 非空；custom 校验 prompt 非空 + workspaceId 必填 + `toolPacksOverride` 过滤为已知包名；builtin 校验 builtinId 合法 + name 等于该 builtinId 的固定 label（拒绝改名）
- [ ] 删除 `detectPlanCycle` / `validateTriggerRefs` / `validateTriggerRefs` 相关的 on_plan_done 引用

### 4. `runtime/plan-runner.ts` — 单任务执行

- [ ] `runTask(task, opts)`：去重判定按 task.id；执行前 `updateTaskRunState(id, { cursorStartedAt: now })`，完成/失败后清 undefined
- [ ] 若 `task.runState?.cursorStartedAt` 存在（上次中断）：先补记 interrupted 历史条目再执行
- [ ] 删除 `resolveQueue` / 队列推进 / `pendingTasks` 逻辑；`appendTaskEntry` 里 `planId`=task.id、`planName`=task.name，不再填 taskId/taskName
- [ ] `PlanDoneEvent` → `TaskDoneEvent { taskId, outcome }`；`plan_done` 事件名改 `task_done`（scheduler-service 不再监听，Step 1 直接删监听）
- [ ] `getActivity` 返回新 `SchedulerRunningPlan` 结构
- [ ] stop 语义简化：`requestStop` 仅影响「当前正在跑的这个任务」——保留接口但行为变为允许当前任务跑完后结束（单任务下等价于自然结束，接口保留给 window 触发器调用点）

### 5. `runtime/task-executor.ts`

- [ ] `executeTask(task: ScheduledTask)`：builtin 分支不动；custom 分支 payload 加 `toolPacksOverride: task.toolPacksOverride`
- [ ] `BUILTIN_LABELS` 移到共享模块（如新文件 `builtin-task-meta.ts`，Step 2 会扩展它），task-executor 改引用

### 6. `custom-agent-tools.ts`

- [ ] `buildCustomToolSet(workspaceId, workspacePath, configDir, override?: string[])`：override 有值时跳过 `readEnabledToolPacks`，直接用 override（过滤未知包名）
- [ ] grep `buildCustomToolSet` 找 worker 侧调用点，把 `CustomAgentTaskPayload.toolPacksOverride` 传进去

### 7. `electron/main/agents/task-types.ts`

- [ ] `CustomAgentTaskPayload` 加 `toolPacksOverride?: string[]`

### 8. `scheduler-service.ts` — 去链式

- [ ] 删 `runner.on('plan_done')` 监听与 `handlePlanDone` 方法
- [ ] `firePlan` → `fireTask`，字段适配（plan.name → task.name 等）
- [ ] `runPlanManual` → `runTaskManual`

### 9. `time-rule-engine.ts`

- [ ] `describeTrigger` / `detectMissed` 等函数中 on_plan_done 分支删除（grep 确认所有引用点）

### 10. `tipc/scheduler.ts` — 既有路由适配

- [ ] 按 plan.md 全局决策映射表改名并适配新类型（listTasks/saveTask/deleteTask/setTaskEnabled/runTaskNow）
- [ ] `deleteTask`：task.kind === 'builtin' 时返回 `{ ok: false, error: '内置任务不能删除' }`
- [ ] `listRunHistory` / `getSchedulerActivity` 名字不变，内部类型适配
- [ ] 渲染层此时还是旧类型，本 step 只保证主进程编译通过（`bun run build:electron`）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：store 导出改名 loadPlans→loadTasks / savePlans→saveTasks；seed 并入 loadTasks 一次性 ensure（删 seedDefaultPlans）；plans.json 新格式为 `{version:2, tasks}` 对象容器；迁移时 builtin 任务 name 固定取 label（不拼前缀）且同一 builtinId 去重保留首条；TaskRunOutcome 收窄为 completed|failed；toolPacksOverride 未知包名过滤落在 tipc saveTask（sanitizeToolPacksOverride）；完整差异见共享区 step1-delivery.md
- 改动文件清单：types.ts、builtin-task-meta.ts（新）、plan-store.ts、plan-validate.ts、runtime/plan-runner.ts、runtime/task-executor.ts、custom-agent-tools.ts、scheduler-service.ts、time-rule-engine.ts、tipc/scheduler.ts、agents/task-types.ts、agents/agent-worker.ts（1 行）

### 给下一步的接力棒
- 关键签名 / 数据结构：loadTasks()/saveTasks()（读时自动迁移+seed）；runTask(task, opts)；runTaskManual(taskId)；minNextDueAt(task, now)；validateTaskForSave(task, {workspaceIds})（builtin name 必须 === label）；buildCustomToolSet(..., override?)；CustomAgentTaskPayload 加 toolPacksOverride；历史条目只填 planId/planName（=任务 id/name）
- 下个 step 该从哪里继续：Step 2 扩展 builtin-task-meta.ts + 内置 prompt 三件套 IPC；渲染层旧调用（stores/scheduler-store.ts 调 client.listPlans 等）在 Step 3 前运行时不可用，属计划内
- 待办或已知限制：review / categorize_organize 提示词模板磁盘化能力待 Step 2 检查补齐；lint 0 errors / 74 warnings 均为渲染层既有 no-explicit-any；详细交接见共享区 step1-delivery.md
