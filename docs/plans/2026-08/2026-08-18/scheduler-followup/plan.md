# 定时计划收尾（入口统一 / 停止 / 任务链）实施计划

**目标**：运行控制唯一入口收敛到定时计划——会话摘要 Tab 只留结果查看与行为配置；stopTask 真正可用；恢复 on_task_done 任务链触发。

**架构思路**：见 [scheduler-followup-design.md](./scheduler-followup-design.md)。停止按 builtinId 分派到各 trigger 管线的 cancel（review/categorize 补清队列 API）；模型选择复用现有三组 IPC 挪进内置任务编辑器；on_task_done 仅上游 completed 触发 + 保存时环检测。

**涉及模块**：
- 主进程：`scheduler/{types,time-rule-engine,plan-validate,scheduler-service}.ts`、`runtime/{plan-runner,task-executor}.ts`、`tipc/scheduler.ts`、`memory/{review-trigger,category-trigger}.ts`
- 渲染层：`types/scheduler.ts`、`stores/scheduler-store.ts`、`app/settings/page.tsx`、`app/settings/memory/{DigestsPanel,SmartCategoryPanel,ReviewPanel}.tsx`、`app/settings/scheduler/{SchedulerPanel,TaskEditor,TriggerListEditor,utils,BuiltinTaskDetailSection}.tsx`
- 文档：`docs/codebase-map.md`

## 步骤索引

- [x] [Step 1: 主进程——stopTask 链路 + on_task_done 引擎](./step1-main-process.md) — requestStop 真实现、两个 cancelAll 新增、task_done 监听、环检测、tipc 路由
- [x] [Step 2: 渲染层——调度器接线](./step2-scheduler-ui.md) — 停止按钮、任务链触发器 UI、内置任务模型选择
- [ ] [Step 3: 会话摘要 Tab 删减 + 文档同步](./step3-digest-panel-trim.md) — 三面板删 agent 入口、ReviewPanel 删除、codebase-map 同步

## 全局决策

- **执行顺序强依赖**：Step 1 → Step 2 → Step 3（Step 2 调 Step 1 的 stopTask IPC；Step 3 删模型入口前提是 Step 2 已把模型选择挪进编辑器）
- **停止语义**：stopTask = 整停（清队列 + 取消当前）；categorize_organize 例外——只 `cancelCategorizeOrganize()`（仅当前是 organize 时生效，不动共享队列里其他类型 job）
- **on_task_done**：仅上游 outcome === 'completed' 时触发下游；失败不连锁；环检测（含自引用）在 saveTask 时拦截
- **模型选择**：builtinId → settings 字段映射 group_digest→ai.digestModelSelection、review→ai.reviewModelSelection、categorize & categorize_organize→ai.categorizeModelSelection；读写走既有 6 条 IPC，onChange 即写盘（与原 Panel 行为一致），主进程零改动
- **历史状态**：custom 取消 → status 'cancelled'；builtin 被停 → status 'completed' 但 summary 追加「（已被手动停止）」（stopRequested 标记）
- **DigestsPanel 轮询**：保留 2s 轮询但只拉组卡列表（去 activity 半边），保证后台提炼时列表自动刷新
- **commit 边界**：工作区现有 dogear__ 前缀与 sidebar 折叠两批未提交改动，本计划文件与其交集仅 `docs/codebase-map.md`——Step 3 提交前先确认前两批已提交（或单独提交本计划改动，避免混批）
- 工具名展示（内置任务工具清单）已自动带 `dogear__` 前缀，本计划不做任何适配
