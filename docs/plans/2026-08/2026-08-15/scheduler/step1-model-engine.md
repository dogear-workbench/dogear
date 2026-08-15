---
step: 1
title: 数据模型 + 时间引擎 + 计划存储
status: done
---

## 目标

定义调度系统全部数据类型，实现纯函数时间规则引擎与计划持久化（含出厂播种），为后续所有步骤打地基。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-15/scheduler-design.md`（数据模型草稿在此，以本文件细化版为准）
- 现有 safe-json 工具：`electron/main/services/safe-json.ts`（原子写 + 备份，直接复用其读写模式，参考 `workspace-json-service.ts` 的用法）
- 时间比较一律用本地时区（现有夜间定时器语义就是本地时间命中 03:xx）
- 关键决策回顾：Trigger 带稳定 `id`；`lastFiredAt` / `once.fired` 内嵌 trigger；任务级 workspaceId（builtin 缺省全部 / custom 缺省当前激活）

## 计划改动

- [x] 新建 `electron/main/services/scheduler/types.ts`：
  - `Plan { id, name, enabled, tasks: PlanTask[], triggers: Trigger[], runState?: PlanRunState, createdAt, updatedAt }`
  - `PlanTask`：`{ id, kind: 'builtin', builtinId: 'group_digest' | 'review' | 'categorize' | 'categorize_organize', workspaceId?: string }` | `{ id, kind: 'custom', name, prompt, modelSelection?: ModelSelection, workspaceId?: string }`（ModelSelection 从 `../settings-types.js` 导入）
  - `Trigger`（带 `id` + `lastFiredAt?: number`）：
    - `{ type: 'daily_at', at: 'HH:mm', weekdays?: number[] }`（weekdays 0=周日..6=周六，缺省每天）
    - `{ type: 'interval', minutes: number }`
    - `{ type: 'window', start: 'HH:mm', end: 'HH:mm', weekdays?: number[] }`（支持跨午夜：start > end 视为次日闭）
    - `{ type: 'once', at: number, fired?: boolean }`
    - `{ type: 'on_window_close', window: { start, end, weekdays? } }`
    - `{ type: 'on_app_start' }` / `{ type: 'on_session_close' }` / `{ type: 'on_plan_done', planId: string }`
  - `PlanRunState { pendingTasks: string[], cursor?: string }`
  - `RunHistoryEntry { id, ts, planId, planName, taskId?, taskName?, kind: 'task' | 'missed', status: 'completed' | 'failed' | 'cancelled' | 'missed' | 'interrupted', triggerReason: 'time' | 'condition' | 'manual', triggerDesc?, startedAt?, endedAt?, summary?, error?, tokens? }`
  - `SchedulerActivity { running: Array<{ planId, planName, currentTaskId?, currentTaskName?, startedAt }>, lastTickAt }`
- [x] 新建 `electron/main/services/scheduler/time-rule-engine.ts`（全部纯函数）：
  - `nextDueAt(trigger, now): number | null` — daily_at 找下一个符合 weekdays 的时刻；interval 返回 `max(lastFiredAt + minutes, now 对齐)`（无 lastFiredAt 则 now）；once 返回未触发的 at；window / on_window_close / 其他条件类返回 null
  - `windowOpen(trigger, now): boolean` — window 与 on_window_close 共用，处理跨午夜与 weekdays
  - `windowCloseAt(trigger, now): number | null` — on_window_close 的触发时刻（当前或下一个窗口的 end）
  - `detectMissed(triggers, lastFiredMap, bootAt)` — 返回错过的 `{ triggerId, missedAt, desc }[]`，每条时间规则只取最近一次错过
  - `minNextDueAt(plan, now): number | null` — 供 UI「下次运行」列（含条件规则里的 on_window_close，其余条件类不参与）
  - `validateTrigger(t): string | null` — 结构合法性（HH:mm 格式、interval > 0、weekdays ∈ 0-6 等）
- [x] 新建 `electron/main/services/scheduler/plan-store.ts`：
  - `loadPlans(): Plan[]` / `savePlans(plans)`（safe-json，文件 `.dogear/plans.json`，路径解析方式参考 settings-service 的 configDir 获取）
  - `seedDefaultPlans()` — 文件不存在时写出厂计划「夜间维护」：`tasks = [builtin group_digest（无 workspaceId）, builtin review（无 workspaceId）]`，`triggers = [window 03:00–05:00, on_app_start, on_session_close]`（trigger id 用 crypto.randomUUID）
  - `updatePlanRunState(planId, runState)` — 供 runner 断点写盘（读-改-写，加模块级互斥或串行队列防并发覆盖）
  - `touchTriggerFired(planId, triggerId, ts)` / `markOnceFired(planId, triggerId)` — 读-改-写保留其余字段
- [x] 前端镜像 `types/scheduler.ts`：导出与主进程一致的类型（Plan/PlanTask/Trigger/PlanRunState/RunHistoryEntry/SchedulerActivity，用 `import type` 交叉引用 `./settings` 的 ModelSelection）——本项目 tsconfig 隔离，不能直接 import 主进程文件

## 验证

- [x] `bun run build:electron` 编译通过
- [x] 临时脚本（跑完删）验证 time-rule-engine：daily_at 带周几跨周、interval 对齐、window 跨午夜（如 22:00–06:00）、once、detectMissed 只取最近一次（另验证了 plan-store 播种/断点/touch/once 失效，临时脚本已删）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - time-rule-engine 额外导出 `windowStartAt`（minNextDueAt 需要窗口 start，否则出厂计划「下次运行」无值）与 `describeTrigger`（missed 条目 triggerDesc 复用）
  - `nextDueAt` 对 daily_at 锚定 `lastFiredAt`（返回 anchor 后第一个时刻，可能是过去值），保证分钟 tick 不因错位漏触发；`minNextDueAt` 用「从 now 起算」视角供 UI
  - plan-store 增 `createDefaultNightPlan()` 导出；`seedDefaultPlans()` 返回 `Promise<Plan[]>`（播种后当前列表，供 step2 初始化）；`updatePlanRunState` 传 `undefined` 清除断点
  - 读-改-写串行化用模块级 promise 队列（不嵌套 safe-json 的 withFileLock，避免同文件死锁）
- 改动文件清单：
  - 新增 `electron/main/services/scheduler/types.ts`
  - 新增 `electron/main/services/scheduler/time-rule-engine.ts`
  - 新增 `electron/main/services/scheduler/plan-store.ts`
  - 新增 `types/scheduler.ts`（前端镜像，未加入 types/index.ts barrel）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `nextDueAt(trigger, now)`：daily_at 锚 lastFiredAt（无则从 now 起算）；interval = max(lastFiredAt+minutes, 对齐分钟 now)，无 lastFiredAt = 对齐 now；once = 未 fired 的 at；其余 null。调度器判定「到点」：`nextDueAt <= now && > lastFiredAt`
  - `windowOpen(trigger, now)`：window/on_window_close 共用；跨午夜 start>end 时后半夜按窗口起始日判 weekdays；end 排他
  - `windowCloseAt(trigger, now)`：当前（含恰在 end 时刻）或下一窗口 end；判定「到点」：`closeAt <= now && > lastFiredAt`
  - `detectMissed(triggers, lastFiredMap, bootAt)`：每规则只取 bootAt 前最近一次错过；lastFiredMap 覆盖 trigger.lastFiredAt
  - `validateTrigger(t)`：null = 合法；`describeTrigger(t)`：中文摘要（on_plan_done 只显示 planId）
  - plan-store：`loadPlans/savePlans/seedDefaultPlans/createDefaultNightPlan/updatePlanRunState/touchTriggerFired/markOnceFired`（savePlans 全量覆盖，savePlan 保留旧 lastFiredAt 的合并逻辑由 step3 tipc 层做）
- 下个 step 该从哪里继续：
  - scheduler-service（分钟 tick + 触发分发 + 启动 detectMissed → 写 missed 历史 + touchTriggerFired 防堆积 + once markOnceFired）
  - 本 step 未在 main/index.ts 接线，无运行时副作用，现有触发点①②③不受影响
- 待办或已知限制：
  - once 的 `at <= bootAt && !fired` 启动时一律记 missed（含故意创建过去时刻）
  - interval 无 lastFiredAt 首次 tick 立即触发（与原启动扫描语义一致）
  - weekdays 重复/乱序值 engine 兼容但不归一化
  - 前端镜像类型未进 types/index.ts barrel，等 UI step 按需引入
