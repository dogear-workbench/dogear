---
step: 2
title: 渲染层——调度器接线
status: done
---

## 目标

定时计划页具备：运行中任务可停止、on_task_done 触发器可编辑（下拉选其他任务、排除自己）、内置任务编辑器可配模型。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-main-process.md] IPC 新增 `stopTask({ taskId }) → { ok, error? }`；Trigger 类型（主进程）加 on_task_done；describeTrigger 主进程签名带可选 taskNameOf
- 当前关键签名（已核实）：
  - `types/scheduler.ts`：Trigger 7 变体（与主进程双份同步）
  - `stores/scheduler-store.ts`：暴露 `tasks / loadTasks / saveTask / deleteTask / setTaskEnabled / runTaskNow / refreshActivity / startActivityPolling`
  - `SchedulerPanel.tsx`：任务行有「运行」按钮（Play 图标），`runningMap: Map<taskId, SchedulerRunningPlan>` 已有
  - `TriggerListEditor.tsx`：Props 仅 `{ triggers, onChange }`；COND_TYPES 三项；renderRow 按 type 渲染控件
  - `TaskEditor.tsx`：builtin 分支 `<BuiltinTaskDetailSection builtinId={draft.builtinId} />`；custom 分支已有 ModelSelector 用法可参考（`useSettingsStore` 取 settings）
  - `BuiltinTaskDetailSection.tsx`：现加载 `{ prompt, tools }`，无模型
  - 模型 IPC（既有，直接用）：`getDigestModelSelection/setDigestModelSelection`、`getReviewModelSelection/setReviewModelSelection`、`getCategorizeModelSelection/setCategorizeModelSelection`（入参 `{ selection: ModelSelection | null }`）
  - `utils.ts`：`describeTrigger(t)`（渲染层版，无 taskNameOf 参数）

## 计划改动

- [x] `types/scheduler.ts`：Trigger 联合加 `{ id; type: 'on_task_done'; taskId: string }`（与主进程同步）
- [x] `app/settings/scheduler/utils.ts`：`describeTrigger(t, taskNameOf?)` 加 on_task_done 分支（对齐 step1 主进程实现）
- [x] `stores/scheduler-store.ts`：加 `stopTask(taskId)`——调 `client.stopTask` + `refreshActivity()`；失败 toast「停止任务失败」
- [x] `SchedulerPanel.tsx`：任务行 `running` 存在时「运行」按钮替换为「停止」（Square 图标、`text-destructive`，title「停止运行中的任务」），onClick 调 `stopTask(task.id)`
- [x] `TriggerListEditor.tsx`：
  - Props 加 `tasks: { id: string; name: string }[]` + `selfTaskId?: string`
  - COND_TYPES 加 `{ value: 'on_task_done', label: '其他任务完成后' }`
  - add() on_task_done 默认 `taskId` 取第一个非自身任务（无候选时禁用该选项）
  - renderRow 加 on_task_done 分支：`<select>` 列出 `tasks.filter(t => t.id !== selfTaskId)`；上游任务被删时当前值不在选项里 → 显示「请选择任务」空选项
  - 摘要行 describeTrigger 调用改传 `taskNameOf = (id) => tasks.find(t => t.id === id)?.name`
- [x] `TaskEditor.tsx`：从 `useSchedulerStore` 取 `tasks`，传 `<TriggerListEditor tasks={tasks.map(t => ({ id: t.id, name: t.name }))} selfTaskId={draft.id || undefined} ... />`（新建时 draft.id 为空 → 全部可选）
- [x] `validateDraft`（TaskEditor 内）：加 on_task_done 校验——taskId 为空提示「触发器 N: 请选择上游任务」
- [x] `BuiltinTaskDetailSection.tsx`：顶部加「模型」行（label + ModelSelector + 「选『不指定』时回退到默认模型」）；builtinId → IPC 映射：
  ```ts
  const MODEL_IO = {
    group_digest: { get: client.getDigestModelSelection, set: client.setDigestModelSelection },
    review: { get: client.getReviewModelSelection, set: client.setReviewModelSelection },
    categorize: { get: client.getCategorizeModelSelection, set: client.setCategorizeModelSelection },
    categorize_organize: { get: client.getCategorizeModelSelection, set: client.setCategorizeModelSelection },
  }
  ```
  初始加载（builtinId 变化时）+ onChange 即写盘；`useSettingsStore` 取 settings 传 ModelSelector（参考 TaskEditor custom 分支用法）
- 验证：`bunx tsc --noEmit -p tsconfig.json`（基线 15 个既有错误外零新增）+ `bun run build:renderer` + `bun run lint`（0 errors / 74 warnings 基线）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - SchedulerPanel 任务行摘要也传了 taskNameOf（计划只要求 TriggerListEditor 摘要行）——否则 on_task_done 在任务列表只能显示无名的「任务完成后」
  - 无候选时选项文案追加「（暂无可选任务）」说明禁用原因
  - 模型写盘失败有 toast（原 Panel 静默），成功不 toast（与原 Panel 一致）
- 改动文件清单：`types/scheduler.ts`、`app/settings/scheduler/utils.ts`、`stores/scheduler-store.ts`、`app/settings/scheduler/SchedulerPanel.tsx`、`app/settings/scheduler/TriggerListEditor.tsx`、`app/settings/scheduler/TaskEditor.tsx`、`app/settings/scheduler/BuiltinTaskDetailSection.tsx`（共 7 文件）
- 验证：tsc 15 errors = 基线零新增；lint 0 errors / 74 warnings = 基线；build:renderer ✓

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `TriggerListEditor` 新 Props `tasks: { id; name }[]`（必填）+ `selfTaskId?: string`，唯一调用方 TaskEditor 已传
  - `BuiltinTaskDetailSection` 顶部「模型」行：MODEL_IO 映射（categorize & categorize_organize 共用 categorizeModelSelection IPC），onChange 即写盘
  - 渲染层 `describeTrigger(t, taskNameOf?)` 双签名已对齐主进程
  - `useSchedulerStore` 现暴露 `stopTask`（调 IPC + refreshActivity，失败 toast「停止任务失败」）
- 下个 step 该从哪里继续：模型选择已全部挪进调度器任务编辑器，可删 DigestsPanel/ReviewPanel/SmartCategoryPanel 的模型选择 UI 与 agent 入口；ReviewPanel 整体删除
- 待办或已知限制：上游被删时 on_task_done 显示无名「任务完成后」且 select 显示「请选择任务」空选项，保存时主进程拦截「目标任务不存在」
