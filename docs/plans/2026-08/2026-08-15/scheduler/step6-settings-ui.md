---
step: 6
title: 前端 store + 设置页「定时计划」Tab
status: pending
---

## 目标

前端 scheduler-store + 设置页新 Tab「定时计划」：计划列表（开关/下次运行/立即运行）与计划编辑器（任务编排、触发器多选、工作区选择），打通全部 CRUD IPC。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step5 的七个 IPC 已可用（`client.listPlans` / `savePlan` / `deletePlan` / `setPlanEnabled` / `runPlanNow` / `listRunHistory` / `getSchedulerActivity`）；step1 的 `types/scheduler.ts` 前端类型
- 前端既有模式：tipc 客户端 `lib/client.ts`；store 模式参考 `smart-category-store.ts`（load + 活动轮询）；组件参考 `app/settings/memory/SmartCategoryPanel.tsx`（折叠编辑器 + 活动状态 + confirm 二次确认的布局模式）；模型选择复用 `components/ModelSelector.tsx`；工作区列表来源执行时查（`workspace-store` 或 IPC listWorkspaces）
- 二次确认一律走 `confirm-store` 的 `showConfirm()`
- 关键决策回顾：任务排序用上下移按钮（不做拖拽）；编辑器内触发器分组多选（时间规则 / 条件规则两组）；列表显示 minNextDueAt

## 计划改动

- [ ] `stores/scheduler-store.ts`：`plans / activity / nextRunAtMap` 状态 + `loadPlans()` / `savePlan(plan)`（含错误 toast）/ `deletePlan` / `setEnabled` / `runNow` / `loadActivity()`（10s 轮询，Tab 激活时启停，模式对齐 smart-category-store）
- [ ] `app/settings/page.tsx`：Tab 列表加「定时计划」
- [ ] 新建 `app/settings/scheduler/` 目录（拆分控制单文件体量）：
  - `SchedulerPanel.tsx` — 面板容器：计划列表（名称 / 启用 Switch / 触发器摘要一行 / 下次运行相对时间 / 编辑·删除·立即运行按钮）+「新建计划」按钮 + 顶部「查看执行历史」链接（跳 `/run-history`，step7 实现路由前先留跳转调用）+ 运行中状态徽章（activity 对应计划）
  - `PlanEditor.tsx` — 计划编辑 Dialog/Sheet：名称输入、任务列表编辑（`TaskListEditor`）、触发器编辑（`TriggerListEditor`）、保存调 store
  - `TaskListEditor.tsx` — 任务行（kind 图标 builtin=齿轮 / custom=sparkles、名称、工作区下拉[全部工作区(仅 builtin)/具体工作区]、上移下移删除）+ 添加：内置任务下拉四选一；自定义任务子表单（名称 + prompt textarea + ModelSelector + 工作区必选）
  - `TriggerListEditor.tsx` — 两组分区：「时间规则」（daily_at：时间+周几多选 chips；interval：分钟数；window：起止时间+周几；once：日期时间选择）、「条件规则」（on_app_start / on_session_close / on_window_close（带窗口参数）/ on_plan_done（计划下拉，排除自身））；每条规则行内编辑 + 删除；同类型可添加多条
  - `utils.ts` — `describeTrigger(t): string`（列表摘要，如「每天 08:00」「周一~周五 00:00–05:00」「窗口关闭 17:00」「启动时」「链式→夜间维护」）、`describeTask(t)`、周几 chips 帮助函数
- [ ] 删除计划 / 禁用正在运行计划走 `showConfirm`；`savePlan` 返回 `{ ok: false, error }` 时 toast error 文案

## 验证

- `bun run dev:renderer` 页面走通：新建计划（1 内置 + 1 自定义任务、多触发器）保存 → 列表出现且下次运行正确显示 → 立即运行 → activity 徽章变化 → 历史条目可查（先用 tipc 调试确认）
- 编辑保留 lastFiredAt：改个名字保存，interval 计划不重置计时（配合后端日志确认）
- 造环保存被拒且错误提示清楚

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
