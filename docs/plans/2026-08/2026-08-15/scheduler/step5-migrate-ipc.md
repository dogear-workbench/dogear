---
step: 5
title: 触发点迁移 + tipc 路由
status: pending
---

## 目标

删除三个硬编码触发点改为调度器承担，新增 scheduler tipc 路由（计划 CRUD / 立即运行 / 历史查询 / 活动快照），完成旧逻辑到新系统的行为切换。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step4 的 `getSchedulerService()`（`handleSessionClose` 入口）已接线启动
- 迁移对象位置：`electron/main/index.ts:528` 附近触发点①（setTimeout 8s 扫描）、`:540` 附近触发点②（digestNightlyTimer setInterval）及其模块顶 `:54` 的变量声明与 `before-quit` 清理段；触发点③（关会话 → triggerByConversation）的具体调用点执行时 grep `triggerByConversation` 定位
- 行为变化（已接受，UI 无需提示）：关会话从「仅提炼该组」变为「触发整个出厂计划」（组提炼扫脏组 + 报告，脏检查保证成本可控）
- 关键决策回顾：出厂计划已还原①②③三触发点语义；设置页手动按钮不动；savePlan 做环检测与合法性校验

## 计划改动

- [ ] `electron/main/index.ts` 迁移：
  - 删触发点① setTimeout、触发点② setInterval 与 `digestNightlyTimer` 声明、before-quit 对应清理
  - 触发点③调用处改为 `getSchedulerService().handleSessionClose(workspaceId)`（保持原调用处的 workspace 上下文参数）
- [ ] 新建 `electron/main/tipc/scheduler.ts` 并在 `tipc/index.ts` 注册：
  - `listPlans(): { plans: Plan[] }` — 含 runState 与每计划 `nextRunAt`（调 `minNextDueAt`，塞进返回对象不写盘）
  - `savePlan(plan): { ok: true } | { ok: false; error }` — 新建（生成 plan.id/task.id/trigger.id + createdAt）或全量更新（按 trigger.id 保留旧 lastFiredAt / once.fired；重置则随内容变化）；校验：name 非空、tasks 非空、逐 trigger `validateTrigger`、`on_plan_done` 目标存在且**不成环**（DFS 检测整张依赖图，含间接环）、workspaceId 存在、custom 任务 prompt 非空
  - `deletePlan(planId)` / `setPlanEnabled(planId, enabled)` — 被其他计划 `on_plan_done` 引用时允许删（运行时容错：依赖目标不存在 → 该条件规则触发时记日志跳过）
  - `runPlanNow(planId): { started: boolean }` — runner.runPlan(triggerReason: 'manual')
  - `listRunHistory({ planId?, cursor?, limit? })` — 透传 run-history-store
  - `getSchedulerActivity(): SchedulerActivity`
- [ ] `run-history-store.cleanupHistory()` 挂到 scheduler-service.init（若 step4 未挂）

## 验证

- `bun run build:electron` 通过
- 行为等价回归：启动后 8s 内出厂计划被 on_app_start 触发（日志可见 runPlan）；系统时间调到 03:0x 等待 tick，窗口开触发、05:00 后停机；关一个会话触发 handleSessionClose
- tipc 手测（开发模式控制台或调试页）：savePlan 造环被拒、非法 HH:mm 被拒、listPlans 带 nextRunAt、runPlanNow 立即产出历史、listRunHistory 分页

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
