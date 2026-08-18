---
step: 3
title: 前端列表与基础编辑
status: pending
---

## 目标

渲染层对接新模型：类型同步、store 改造、列表行 = 任务、编辑对话框骨架（名称/工作区/触发器/自定义 prompt+模型）、删除旧 TaskListEditor。完成标志：`bun run dev:renderer` 编译通过，任务列表 CRUD / 开关 / 立即运行 / 执行历史全部可用。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-main-model-migration.md] IPC 路由已改名（listTasks/saveTask/deleteTask/setTaskEnabled/runTaskNow，见 plan.md 映射表）；[step2-builtin-prompt-tools.md] 新增 getBuiltinTaskDetail 等三路由
- 当前关键文件状态：
  - `types/scheduler.ts`：旧 Plan 模型（与主进程那份结构相同，需同步重写）
  - `stores/scheduler-store.ts`：plans/loadPlans/savePlan/deletePlan/setPlanEnabled/runNow 等方法对接旧路由
  - `SchedulerPanel.tsx`：行 = 计划，显示任务链（`tasks.map(describeTask).join(' → ')`）
  - `PlanEditor.tsx`：Dialog（sm:max-w-2xl）编辑名称 + TaskListEditor + TriggerListEditor
  - `TaskListEditor.tsx`：待删除
  - `TriggerListEditor.tsx`：含「链式」选项（on_plan_done，依赖 plans 下拉）
  - `utils.ts`：describeTask/describeTrigger 等
- 关键决策回顾：编辑对话框放大到 `sm:max-w-4xl` 并加高（本 step 骨架即用新尺寸）；内置任务行不渲染删除按钮；历史侧滑不放大

## 计划改动

### 1. `types/scheduler.ts` — 与主进程 step1 新模型同步重写

### 2. `stores/scheduler-store.ts`

- [ ] state：`plans` → `tasks`（`ScheduledTaskWithNextRun[]`）
- [ ] 方法对接新路由：`loadTasks` / `saveTask` / `deleteTask`（内置删除后端已拒，前端也按 kind 隐藏入口）/ `setTaskEnabled` / `runTaskNow`
- [ ] activity 轮询适配新 `SchedulerRunningPlan`（taskId/taskName）
- [ ] 历史相关方法不变（listRunHistory 签名未改）

### 3. `app/settings/scheduler/SchedulerPanel.tsx`

- [ ] 行 = 任务：名称（内置加 Cog 标识）、触发器摘要、下次运行、开关、编辑/运行按钮；内置无删除按钮，自定义有删除（confirm 文案沿用）
- [ ] 「新建计划」→「新建任务」（只建自定义任务）；运行中 Badge 直接显示 taskName
- [ ] HistorySheet 打开逻辑不动

### 4. `app/settings/scheduler/TaskEditor.tsx` — 新建（替代 PlanEditor.tsx）

- [ ] Dialog `sm:max-w-4xl max-h-[85vh]`，编辑单任务草稿
- [ ] builtin 任务区：固定名称（只读）、工作区（全部/指定）、触发器编辑
- [ ] custom 任务区：名称、prompt（Textarea）、模型（ModelSelector）、工作区、触发器编辑
- [ ] 校验逻辑从旧 PlanEditor.validateDraft + TaskListEditor 的规则合并适配单任务
- [ ] 本 step 不含工具区与内置提示词区（step4 补）

### 5. 删除 `PlanEditor.tsx`、`TaskListEditor.tsx`

### 6. `TriggerListEditor.tsx`

- [ ] 删「链式」选项与 on_plan_done 相关 UI（plans 下拉参数一并去掉）

### 7. `utils.ts` / `page.tsx` / `HistorySheet.tsx` / `HistoryEntryCard.tsx` / `history-utils.ts`

- [ ] `utils.ts`：describeTask 删除；describeTrigger 去 on_plan_done；WorkspaceOption 等保留
- [ ] `page.tsx:669` 定时计划 tab 描述文案改为单任务模型语义
- [ ] HistorySheet 筛选 label「按计划筛选」→「按任务筛选」；RunningSection 适配新 activity 结构
- [ ] HistoryEntryCard 若展示 taskName 兜底 planName（新条目只有 planName）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
