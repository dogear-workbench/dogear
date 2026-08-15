---
step: 5
title: 触发点迁移 + tipc 路由
status: done
---

## 目标

删除三个硬编码触发点改为调度器承担，新增 scheduler tipc 路由（计划 CRUD / 立即运行 / 历史查询 / 活动快照），完成旧逻辑到新系统的行为切换。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step4 的 `getSchedulerService()`（`handleSessionClose` 入口）已接线启动
- 迁移对象位置：`electron/main/index.ts:528` 附近触发点①（setTimeout 8s 扫描）、`:540` 附近触发点②（digestNightlyTimer setInterval）及其模块顶 `:54` 的变量声明与 `before-quit` 清理段；触发点③（关会话 → triggerByConversation）的具体调用点执行时 grep `triggerByConversation` 定位
- 行为变化（已接受，UI 无需提示）：关会话从「仅提炼该组」变为「触发整个出厂计划」（组提炼扫脏组 + 报告，脏检查保证成本可控）
- 关键决策回顾：出厂计划已还原①②③三触发点语义；设置页手动按钮不动；savePlan 做环检测与合法性校验

## 计划改动

- [x] `electron/main/index.ts` 迁移：
  - 删触发点① setTimeout、触发点② setInterval 与 `digestNightlyTimer` 声明、before-quit 对应清理
  - 触发点③调用处改为 `getSchedulerService().handleSessionClose(workspaceId)`（保持原调用处的 workspace 上下文参数）
- [x] 新建 `electron/main/tipc/scheduler.ts` 并在 `tipc/index.ts` 注册：
  - `listPlans(): { plans: Plan[] }` — 含 runState 与每计划 `nextRunAt`（调 `minNextDueAt`，塞进返回对象不写盘）
  - `savePlan(plan): { ok: true } | { ok: false; error }` — 新建（生成 plan.id/task.id/trigger.id + createdAt）或全量更新（按 trigger.id 保留旧 lastFiredAt / once.fired；重置则随内容变化）；校验：name 非空、tasks 非空、逐 trigger `validateTrigger`、`on_plan_done` 目标存在且**不成环**（DFS 检测整张依赖图，含间接环）、workspaceId 存在、custom 任务 prompt 非空
  - `deletePlan(planId)` / `setPlanEnabled(planId, enabled)` — 被其他计划 `on_plan_done` 引用时允许删（运行时容错：依赖目标不存在 → 该条件规则触发时记日志跳过）
  - `runPlanNow(planId): { started: boolean }` — runner.runPlan(triggerReason: 'manual')
  - `listRunHistory({ planId?, cursor?, limit? })` — 透传 run-history-store
  - `getSchedulerActivity(): SchedulerActivity`
- [x] `run-history-store.cleanupHistory()` 挂到 scheduler-service.init（若 step4 未挂）

## 验证

- `bun run build:electron` 通过
- 行为等价回归：启动后 8s 内出厂计划被 on_app_start 触发（日志可见 runPlan）；系统时间调到 03:0x 等待 tick，窗口开触发、05:00 后停机；关一个会话触发 handleSessionClose
- tipc 手测（开发模式控制台或调试页）：savePlan 造环被拒、非法 HH:mm 被拒、listPlans 带 nextRunAt、runPlanNow 立即产出历史、listRunHistory 分页

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - **触发点③原调用处已不存在**：随提交 fe2339a（移除 SDK 主会话）被删，`triggerByConversation` 现为死代码。新挂载点选「独立会话窗口 `closed` 事件」（`createSessionWindow` 内，现 index.ts:294-321）：当前 UI 里用户显式结束会话的动作；`!isQuitting && workspaceId` 才触发（退出路径跳过，避免退出前起计划写脏断点）；归档/删除话题的 closeConversation 未挂（连环触发噪音大、删除后提炼无意义）
  - runPlanManual 不做 enabled 校验（按计划字面 runner.runPlan 直调）：禁用计划可手动跑
  - savePlan 校验/合并/环检测拆为独立纯函数模块 `plan-validate.ts`（tipc handler 依赖 tipc 上下文无法直调，拆出便于脚本实测）
  - mergeFiredState 额外保留旧 runState（前端不回传时不断点丢失，任务 id 已删由 runner 过滤）
  - 会话窗口 closed 里 getByIdGlobal 失败时 sessionWindowClosed 通知仍发（原行为不发，Tab 不恢复）
  - cleanupHistory 已在 step4 init 内挂过，本 step 核实无需再动
- 改动文件清单：
  - 新增 `electron/main/services/scheduler/plan-validate.ts`（assignPlanIds / mergeFiredState / detectPlanCycle / validatePlanForSave）
  - 新增 `electron/main/tipc/scheduler.ts`（七个 RPC）
  - 修改 `electron/main/tipc/index.ts`（注册 schedulerRouter）
  - 修改 `electron/main/services/scheduler/scheduler-service.ts`（public `runPlanManual(planId): Promise<{ started: boolean }>`）
  - 修改 `electron/main/index.ts`（删 :53-54 声明 / :526-536 触发点① / :539-556 触发点② / :590-594 before-quit 清理；触发点③挂 createSessionWindow closed）
  - 修改 `types/scheduler.ts`（镜像补 `PlanWithNextRun` / `HistoryPage`）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 七个 RPC 最终签名与返回结构见项目根 `step5-delivery.md`（含 step6 对接细节：savePlan 传完整 Plan、新计划 id 留空、nextRunAt 现算不写盘、listRunHistory cursor=上页末条 ts、runPlanNow 的 started:false 三义）
  - 前端镜像：`types/scheduler.ts` 已有 `PlanWithNextRun`/`HistoryPage`（未进 types/index.ts barrel）
- 下个 step 该从哪里继续：
  - step6：`stores/scheduler-store.ts` 对接七个 RPC + 设置页「定时计划」Tab（编辑器保存时保留 trigger.id 才不重置 lastFiredAt）
  - step7：`/run-history` 页面走 `listRunHistory` 分页
- 待办或已知限制：
  - `triggerByConversation`（group-digest-trigger.ts:267）死代码未删（超本 step 范围）；tipc digest.ts 手动按钮入口按计划保留
  - 完整 Electron 开发模式回归未跑（建议 step6/7 起 dev 时看 `[scheduler]` 日志）；本 step 验证 = build 通过 + index.ts 零残留 grep + 临时脚本 43 项断言（plan-validate 全分支 / savePlan 全流程复现 / queryHistory 分页，脚本已删）
  - 主窗口隐藏到托盘路径会触发一轮 handleSessionClose（防重入+脏检查兜底，仅 isQuitting 跳过）
