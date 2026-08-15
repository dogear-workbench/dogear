---
step: 6
title: 前端 store + 设置页「定时计划」Tab
status: done
---

## 目标

前端 scheduler-store + 设置页新 Tab「定时计划」：计划列表（开关/下次运行/立即运行）与计划编辑器（任务编排、触发器多选、工作区选择），打通全部 CRUD IPC。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step5 的七个 IPC 已可用（`client.listPlans` / `savePlan` / `deletePlan` / `setPlanEnabled` / `runPlanNow` / `listRunHistory` / `getSchedulerActivity`）；step1 的 `types/scheduler.ts` 前端类型
- 前端既有模式：tipc 客户端 `lib/client.ts`；store 模式参考 `smart-category-store.ts`（load + 活动轮询）；组件参考 `app/settings/memory/SmartCategoryPanel.tsx`（折叠编辑器 + 活动状态 + confirm 二次确认的布局模式）；模型选择复用 `components/ModelSelector.tsx`；工作区列表来源执行时查（`workspace-store` 或 IPC listWorkspaces）
- 二次确认一律走 `confirm-store` 的 `showConfirm()`
- 关键决策回顾：任务排序用上下移按钮（不做拖拽）；编辑器内触发器分组多选（时间规则 / 条件规则两组）；列表显示 minNextDueAt

## 计划改动

- [x] `stores/scheduler-store.ts`：`plans / activity` 状态 + `loadPlans()` / `savePlan(plan)`（含错误 toast）/ `deletePlan` / `setEnabled` / `runNow` / `refreshActivity()`（10s 轮询，Tab 激活时启停，模式对齐 smart-category-store）
- [x] `app/settings/page.tsx`：Tab 列表加「定时计划」（「会话摘要」之后）
- [x] 新建 `app/settings/scheduler/` 目录（拆分控制单文件体量）：
  - `SchedulerPanel.tsx` — 计划列表（名称 / 启用 Switch / 触发器摘要一行 / 下次运行相对时间 / 编辑·删除·立即运行按钮）+「新建计划」按钮 +「查看执行历史」（closeSettings + hash 跳 `/run-history`，step7 建路由）+ 运行中徽章（activity 对应计划）
  - `PlanEditor.tsx` — 计划编辑 Dialog：名称输入、任务列表编辑、触发器编辑、保存前客户端预校验（validateDraft 就地显示）+ 保存调 store
  - `TaskListEditor.tsx` — 任务行（kind 图标 builtin=Cog / custom=Sparkles、名称、工作区下拉[全部工作区(仅 builtin)/具体工作区]、上移下移删除）+ 内置任务下拉四选一；自定义任务子表单（名称 + prompt textarea + ModelSelector + 工作区必选，预填当前激活工作区）
  - `TriggerListEditor.tsx` — 两组分区：「时间规则」（daily_at：时间+周几 chips；interval：分钟数；window：起止时间+周几；once：datetime-local）、「条件规则」（on_app_start / on_session_close / on_window_close（带窗口参数）/ on_plan_done（计划下拉，排除自身））；每条规则行内编辑 + 删除 + 行尾实时摘要预览；同类型可添加多条
  - `utils.ts` — `describeTrigger(t, planNameOf?)`（on_plan_done 显示计划名）、`describeTask(t)`、`formatRelativeFuture`、周几 chips 帮助、datetime-local 双向转换
- [x] 删除计划 / 停用正在运行计划走 `confirm`（confirm-store）；`savePlan` 返回 `{ ok: false, error }` 时 toast error 文案

## 验证

- [x] lint（改动文件零警告）+ `bunx tsc --noEmit -p tsconfig.json`（scheduler 相关零错误；全库 16 个存量错误在未触碰文件）+ `bun run build:renderer` 通过
- [ ] 页面全链路（新建→列表→立即运行→activity 徽章→历史、编辑保留 lastFiredAt、造环被拒）需主进程，留 step7 完整 dev 模式回归（代码走查已覆盖对应分支）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：详见项目根 `step6-delivery.md`「与计划的差异说明」（13 条）。要点：无独立 nextRunAtMap（nextRunAt 内嵌 PlanWithNextRun）；轮询 API 为 refreshActivity + startActivityPolling/stopActivityPolling；describeTrigger 前端镜像增强（on_plan_done 经 planNameOf 回调显示计划名）；保存前加客户端预校验 validateDraft（错误就地显示不发 IPC）；历史跳转 = closeSettings + window.location.hash（设置页在 Router 外）；编辑 draft 显式 pick Plan 字段（剥离 nextRunAt/runState，保留 trigger.id 与 lastFiredAt/once.fired）；Switch 用 components/ui/switch.tsx；runNow 三态区分（运行中 → info「计划正在运行中」）；新建 custom 任务预填当前激活工作区；相对时间 60s tick 刷新
- 改动文件清单：新增 `stores/scheduler-store.ts`（136 行）、`app/settings/scheduler/{utils,SchedulerPanel,PlanEditor,TaskListEditor,TriggerListEditor}`（93/187/133/180/248 行）；修改 `app/settings/page.tsx`（+Tab）；未动 types/scheduler.ts 与 src/App.tsx

### 给下一步的接力棒
- 关键签名 / 数据结构：store 对外 API、组件树、历史页可复用清单（describeTrigger/describeTask/BUILTIN_TASK_LABELS/formatRelativeFuture、listRunHistory 分页语义）全部在 `step6-delivery.md`；历史页路由只需 src/App.tsx 加 `/run-history` Route（SchedulerPanel.handleViewHistory 已做跳转调用）
- 下个 step 该从哪里继续：step7 = `/run-history` 页面 + 完整 dev 模式回归（tipc 联通、编辑不重置 interval 计时、环检测 toast）
- 待办或已知限制：once 已 fired 改时间不重置（需删了重加）；编辑器内 plans 快照不实时刷新；on_plan_done 目标被删后编辑保存被后端拒（UI toast 后端文案）；下次运行列 60s 刷新；纯条件计划显示 '—'。全部详见 step6-delivery.md「待办或已知限制」
