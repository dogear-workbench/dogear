# 定时计划系统（Scheduler）设计

**日期**：2026-08-15
**状态**：设计定稿，待实施

## 背景

现有后台 agentwork（组卡提炼 / 首页报告 / 智能分类 / 分类整理）的触发方式是硬编码的：启动 8s 扫描（`electron/main/index.ts` 触发点①）、夜间 03 点定时器（触发点②）、关会话触发（触发点③）、组卡保存链式分类。用户无法配置时间，也无法定时执行自定义 agent 任务。

## 目标

做一套通用的定时计划系统：

1. **计划 = 任务序列 + 触发器**。任务可编排内置任务（组提炼/报告/分类/整理）和自定义 agent 任务（prompt 驱动），计划内串行执行、不同计划并行。
2. **灵活的时间系统**：定点循环、间隔循环、窗口期（窗口内连续消费任务队列）、一次性，均可叠加周几限定；时间规则与条件规则多选、OR 语义（任一命中即触发）。
3. **条件触发**：窗口关闭、应用启动、会话关闭、链式（依赖另一计划完成）。
4. **运行历史**：独立页面，记录每次运行（含错过）的开始/结束、状态、触发原因、结果摘要、token 用量。
5. **迁移**：现有三个硬编码触发点全部迁移为出厂默认计划，走新调度器。

## 架构

### 数据模型

```ts
// 全局 .dogear/plans.json（safe-json 原子写）

interface Plan {
  id: string
  name: string
  enabled: boolean
  tasks: PlanTask[]
  triggers: Trigger[]          // OR 语义
  runState?: PlanRunState      // 断点持久化（每次任务切换时落盘）
}

type PlanTask =
  | { id: string; kind: 'builtin'; builtinId: 'group_digest' | 'review' | 'categorize' | 'categorize_organize'
      workspaceId?: string }   // 缺省 = 全部工作区（现有语义）
  | { id: string; kind: 'custom'; name: string; prompt: string
      modelSelection?: ModelSelection   // 缺省走 defaultModelSelection
      workspaceId?: string }   // 缺省 = 当前激活工作区；自定义任务必须有工作区上下文

type Trigger =
  // 时间规则
  | { type: 'daily_at';    at: string; weekdays?: number[] }   // '08:00'，weekdays 0-6
  | { type: 'interval';    minutes: number }
  | { type: 'window';      start: string; end: string; weekdays?: number[] }
  | { type: 'once';        at: number; fired?: boolean }       // 触发或错过即失效
  // 条件规则
  | { type: 'on_window_close'; window: { start: string; end: string; weekdays?: number[] } }
  | { type: 'on_app_start' }
  | { type: 'on_session_close' }
  | { type: 'on_plan_done'; planId: string }

interface PlanRunState {
  pendingTasks: string[]      // 未执行的任务 id 队列
  cursor?: string             // 当前执行中的任务 id
}
```

### 模块布局

```
electron/main/services/scheduler/
  scheduler-service.ts    调度核心：分钟级 tick、时间规则求值分发、条件事件订阅、错过判定
  plan-store.ts           计划持久化（plans.json 读写 + 出厂播种）
  run-history-store.ts    运行历史（.dogear/run-history/YYYY-MM.jsonl，按月分文件，自动清理）
  time-rule-engine.ts     纯函数：规则 → nextDueAt / 窗口开闭判定 / 错过检测（可单测）
  runtime/plan-runner.ts  计划执行器：任务队列消费、断点持久化、窗口停机、并行控制、事件发出
```

### 关键决策

1. **不引 cron 库**。核心语义（窗口期连续消费队列、断点续跑、错过记 missed、OR 组合）全是自定义的，cron 只能覆盖「下次触发时刻」一小块；自研分钟级 tick + 纯函数求值引擎更贴合。
2. **自定义任务走 agent-manager Worker 池**（新任务类型 `CUSTOM_AGENT`），与现有四条后台任务同构：pi `runOnce` + 按权限配置组装工具集（复用主会话工具注册表 + `settings.basicToolPermissions` / 工具包开关），天然支持取消与 usage 采集（复用 extractPiUsageEntry）。不用 PiSession 起无头会话。
3. **内置任务不重写**：plan-runner 直接触发现有 trigger 层函数（`triggerScanAll(workspaceId?)` 等加可选工作区参数），现有串行队列、脏检查、链式分类逻辑原样保留；设置页手动按钮与计划互不影响。
4. **产物是任务内部的事**：自定义任务的 agent 用工具自己产出（WriteReport / SaveMemory / Write 等），调度器只记录执行历史，不管理产物。跑完不弹通知。

## 调度与执行行为

### tick 求值（每分钟一次）

- 每条时间规则维护 `lastFiredAt`，`time-rule-engine` 纯函数算 `nextDueAt`；到点触发计划。
- 窗口规则维护开/闭状态：窗口开 → 计划运行态（开始消费队列）；窗口闭 → 停机信号（跑完当前任务，未完成存 `runState.pendingTasks`）。
- **错过判定**：启动时对比 `lastFiredAt` 与规则求值，发现错过 → 历史记一条 `missed`（多条错过只记最近一条，防堆积）；一次性任务错过即记 missed 且规则标记 fired 失效。
- **不补跑**：错过的触发只在历史里标记，不补偿执行。

### 触发与执行（plan-runner）

- 命中任一规则 → 创建 run 实例：无断点则整队入列，有 `pendingTasks` 断点则从断点继续。
- 计划内逐任务串行；不同计划并行（各自 runner 实例）；多计划的自定义任务受 Worker 池上限（4）自然排队。
- 每任务开始/结束各写一条 run-history（outcome、结果摘要、token 用量）。
- **防重入**：同一计划运行中再次命中触发 → 忽略并记日志，不叠队列。

### 条件事件

- `on_app_start`：调度器初始化后发出。
- `on_session_close`：会话关闭路径发事件（替代现有触发点③）。
- `on_window_close`：自带窗口参数，tick 到窗口结束时刻触发。
- `on_plan_done`：plan-runner 完成时发出；**保存计划时做依赖环检测**，拒绝 A→B→A。

## IPC 与 UI

### tipc 路由（新 `electron/main/tipc/scheduler.ts`）

- `listPlans` / `savePlan`（触发器合法性 + 链式环校验）/ `deletePlan` / `setPlanEnabled`
- `runPlanNow(planId)` — 手动立即运行
- `listRunHistory({ planId?, cursor? })` — 分页查询
- `getSchedulerActivity()` — 正在运行的计划/任务快照（前端轮询）

### UI

1. **设置页新 Tab「定时计划」**：计划列表（名称、启用开关、触发器摘要、下次运行时刻 = min nextDueAt）+ 计划编辑器（任务增删/上下移排序/每任务工作区选择、触发器分组多选编辑、内置任务下拉、自定义任务 prompt 与模型编辑）。
2. **独立页面「执行历史」**：时间倒序运行记录（计划名、任务名、状态徽章[运行中/完成/失败/取消/错过/中断]、触发原因、起止时间、token 用量、结果摘要可展开），missed 灰色显示「未运行」。

## 迁移

- 删除 `electron/main/index.ts` 的启动 setTimeout（触发点①）与夜间 setInterval（触发点②）。
- 关会话触发路径（触发点③）改为发调度器事件。
- 首次启动 `plans.json` 不存在时播种**出厂计划**「夜间维护」：
  - 任务：[组提炼(全部工作区), 报告(全部工作区)]
  - 触发器：[窗口期 03:00–05:00, 应用启动, 会话关闭]
  - 完整还原现有行为，用户可改可禁用。
- 前端新增 `scheduler-store.ts`（计划列表 + 活动 + 历史），历史页面走独立路由。

## 错误处理 / 边界情况

- **主进程异常重启**：`runState` 每次任务切换时落盘，重启后断点续跑，中断那次记 `interrupted`。
- **依赖计划被删 / 工作区被删**：savePlan 时校验 + 运行时二次校验，任务记 `failed` 带原因。
- **窗口关闭**：跑完当前任务再停（不硬中断）；当前任务允许超窗完成。
- **计划运行中应用退出**：随 runState 断点自然恢复。
- **plans.json 损坏**：safe-json 备份恢复机制兜底。

## 未决问题（实施时定）

- run-history 自动清理的保留时长（拟 3 个月，实施时确认）。
- 出厂计划窗口结束时刻 05:00 为拟定值（原逻辑仅 03 点触发扫描，无窗口概念）。
- 计划编辑器任务排序交互：上下移按钮（拟）vs 拖拽。
- 结果摘要的截取长度与格式。
