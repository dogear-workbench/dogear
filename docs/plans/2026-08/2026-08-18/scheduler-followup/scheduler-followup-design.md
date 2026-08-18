# 定时计划收尾：入口统一 + 手动停止 + 任务链触发 设计

**背景**：单任务模型重构（5 step 已完成）后遗留四个收尾需求：
1. 会话摘要 Tab 与定时计划的内置任务入口重复（模型/提示词/运行/停止双入口）
2. 定时计划无手动停止（`TaskRunner.requestStop` 是 no-op，连 window 触发器「关窗口停」也因此失效）
3. 条件触发器语义答疑（on_window_close / on_session_close，已答复，无代码改动）
4. 链式触发在重构中被删，需以单任务形态恢复（`on_task_done`）

**目标**：运行控制唯一入口收敛到定时计划；会话摘要 Tab 只留结果查看与行为配置；停止能力真正可用；恢复「跟着其他任务触发」。

## 改动一：会话摘要 Tab 去 agent 入口

**DigestsPanel**（删运行控制，留结果）：
- 删：提炼模型 ModelSelector、停止/重新开始按钮、活动状态轮询区、提示词折叠编辑器
- 留：组卡列表 + 详情（概述/想法/决策/关键产出/回溯链接）
- 留：单组「重新提炼」按钮（详情区操作，单组补跑调度器替代不了）
- 列表 2s 轮询保留但只拉列表（原轮询同时拉 activity + list，去掉 activity 半边）

**ReviewPanel**：整个删除。page.tsx 移除「跨会话复盘」分节——复盘卡查看在首页仪表盘，模型/提示词/立即复盘全部由定时计划内置任务覆盖。

**SmartCategoryPanel**（删运行控制，留行为配置与结果）：
- 删：分类模型 ModelSelector、立即重跑全部分类、一键整理现有标签、活动状态轮询区、提示词折叠编辑器
- 留：总开关 / 匹配阈值 / 分类上限（实时行为配置，不属于定时任务）、当前分类列表

**page.tsx**：会话摘要 tab 三段描述文案同步（去「配置方案与提示词/立即重跑」表述）。

## 改动二：模型选择挪进内置任务编辑器

`BuiltinTaskDetailSection` 顶部加「模型」行（ModelSelector + 「选『不指定』时回退到默认模型」提示），onChange 即写盘（与原 Panel 行为一致）。

builtinId → 现有 IPC 映射（**主进程零改动**，复用 6 条既有路由）：

| builtinId | 读 | 写 | settings 字段 |
|---|---|---|---|
| group_digest | getDigestModelSelection | setDigestModelSelection | ai.digestModelSelection |
| review | getReviewModelSelection | setReviewModelSelection | ai.reviewModelSelection |
| categorize / categorize_organize | getCategorizeModelSelection | setCategorizeModelSelection | ai.categorizeModelSelection |

执行链回退（payload.modelSelection ?? settings.xxx ?? default）不动。

## 改动三：stopTask（手动停止）

**主进程**：
- `task-executor.ts`：`executeTask(task, hooks?)`，`hooks.onAgentTaskId(id)` 在 runCustomTask 生成 agentTask.id 后上报
- `plan-runner.ts`：RunningInfo 存 `task` + `agentTaskId?`；`requestStop` 真实现，按类型分派：
  - custom → `getAgentManager().cancelTask(agentTaskId)`
  - group_digest → `cancelAllGroupDigest()`（清队列 + 取消当前，既有）
  - review → **新增** `cancelAllReview()`：清 queue + cancel 当前（原先只有停当前，队列会继续泵——调度器「停止」语义要求整停）
  - categorize → **新增** `cancelAllCategorize()`：清队列 + `cancelCurrent()`
  - categorize_organize → `cancelCategorizeOrganize()`（仅当前是 organize 时生效，与原语义一致）
- 停止标记：TaskRunner 记 `stopRequested`，executeTask 返回后若被停过，历史 summary 追加「（已被手动停止）」；custom 的 CANCELLED → status 'cancelled'（RunHistoryEntry.status 已兼容）
- `scheduler-service.ts`：`stopTask(taskId)` 公开方法（校验 running 后调 requestStop）
- `tipc/scheduler.ts`：`stopTask: t.procedure.input<{ taskId }>` → `{ ok, error? }`

**前端**：
- `scheduler-store.ts`：`stopTask` 方法（调 IPC + refreshActivity）
- `SchedulerPanel.tsx`：任务行 running 时「运行」按钮替换为红色「停止」（Square 图标），无 running 时恢复「运行」

## 改动四：on_task_done（跟着其他任务触发）

**类型**（主进程 `scheduler/types.ts` + 渲染层 `types/scheduler.ts` 双份）：
```ts
{ id: string; type: 'on_task_done'; taskId: string }
```

**主进程**：
- `scheduler-service.ts`：init 时 `runner.on('task_done')`——**仅 outcome === 'completed'** 时遍历任务，匹配 `on_task_done.taskId === 上游 id` 的触发器 fireTask（triggerReason 'condition'，triggerDesc `任务「上游名」完成后`）。失败不连锁。
- `time-rule-engine.ts`：`describeTrigger(trigger, taskNameOf?)` 补分支 `任务「X」完成后`；`validateTrigger` 校验 taskId 非空。minNextDueAt / detectMissed 不处理（事件型无时间锚）
- `plan-validate.ts`：`validateTaskForSave` 加两项——引用校验（on_task_done.taskId 存在于任务集）+ **环检测**（沿 on_task_done 边 DFS，A→B→A 或自引用拒绝保存「任务链触发不能构成循环」）

**前端**：
- `types/scheduler.ts` 同步 Trigger 联合类型
- `utils.ts`：`describeTrigger` 加可选 `taskNameOf` 参数
- `TriggerListEditor.tsx`：COND_TYPES 加 `{ value: 'on_task_done', label: '其他任务完成后' }`；Props 加 `tasks: { id, name }[]` + `selfTaskId?: string`；行内渲染任务下拉（**排除自己**）；add() 默认选第一个非自身任务；列表/编辑器摘要行经 taskNameOf 显示任务名
- `TaskEditor.tsx`：从 `useSchedulerStore` 取 `tasks` 传给 TriggerListEditor（selfTaskId = draft.id，新建时空 → 全部可选）

**迁移**：无（新触发器类型；重构时被删的旧链式无法找回，需在界面上手动重配——已知代价）。

## 模块边界（涉及文件）

主进程：`scheduler/types.ts`、`time-rule-engine.ts`、`plan-validate.ts`、`scheduler-service.ts`、`runtime/plan-runner.ts`、`runtime/task-executor.ts`、`tipc/scheduler.ts`、`memory/review-trigger.ts`（+cancelAllReview）、`memory/category-trigger.ts`（+cancelAllCategorize）
渲染层：`types/scheduler.ts`、`stores/scheduler-store.ts`、`app/settings/page.tsx`、`app/settings/memory/DigestsPanel.tsx`、`app/settings/memory/SmartCategoryPanel.tsx`、`app/settings/memory/ReviewPanel.tsx`（删文件）、`app/settings/scheduler/{SchedulerPanel,TaskEditor,TriggerListEditor,utils,BuiltinTaskDetailSection}.tsx`
文档：`docs/codebase-map.md`

## 数据流

- 停止：SchedulerPanel → store.stopTask → IPC stopTask → service.stopTask → runner.requestStop → 分派到 agentManager.cancelTask / 各 trigger cancelAll → 管线置 idle → executeTask resolve → 历史落盘（标注停止）→ task_done
- 任务链：上游 executeSingleTask finally → task_done(completed) → service 监听 → 匹配下游 on_task_done → fireTask（running 去重天然防重入）

## 错误处理 / 边界

- stopTask 对未运行任务：requestStop 查 running 无命中直接返回（幂等，不报错）
- on_task_done 上游被删：saveTask 时引用校验拦截；已存量引用后删除上游 → fire 时 loadTasks 找不到上游仅记日志（不崩）；编辑下游时下拉显示空值提示重选
- 环检测在保存时拦截（自引用也拦）；运行期链 A→B 单向无环，天然安全
- window 触发器关闭调 requestStop 的既有调用点自动受益（no-op 变真停），无需改 window 逻辑
- DigestsPanel 删活动轮询后，「队列/正在提炼」可视性转移到定时计划 SchedulerPanel 的运行中徽章 + 执行历史

## 已拍板决策（原未决问题）

- DigestsPanel 单组「重新提炼」按钮：**保留**（单组补跑，调度器只有全量任务替代不了）
- review/categorize 停止时**清队列**（比原先「只停当前」更彻底）：按调度器「停止任务」语义取整停

## 与 dogear__ 工具前缀改动（未提交）的关系

- `builtin-task-meta.ts` / 各 prompt 模板已加前缀：`getBuiltinTaskDetail` 返回的 tools 自动带 `dogear__` 前缀，前端 Badge 纯展示自动跟随，**本设计无需适配**
- 本设计涉及的 `group-digest-trigger.ts` / `review-trigger.ts` / `category-trigger.ts` / `agent-manager.cancelTask` / 模型三组 IPC 均未被前缀改动触碰，签名有效
- 文件级交集仅 `docs/codebase-map.md`（两边都会做 doc-sync）：实施前建议先提交前缀改动，避免 commit 混批
