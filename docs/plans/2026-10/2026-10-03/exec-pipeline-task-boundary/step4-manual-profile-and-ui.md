---
step: 4
title: 类型手动改口 + 笔记折叠展开
status: done
---

## 目标
plan/backlog 态任务可在面板/详情手动切换 execProfile（queued 后不可改）；笔记栏「Agent 转存」「更早的手记」折叠分组默认展开。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-pipeline-symmetry.md] 管道已按类型查表（default=[]/code-impl=['staged-execution']），改口后即时生效
- 当前关键文件状态：
  - `electron/main/services/task-store.ts`：mutateTasks 模式（:147-156）为所有写操作范式；Task.execProfile 可选字段（:22）
  - `electron/main/tipc/tasks.ts`：现有任务 tipc 路由（无 create/planPath 入口，面板只读+状态操作）
  - `components/notes/TaskPanel.tsx:234`、`components/notes/TaskDetail.tsx:149` 使用 `TaskExecProfileBadge`（`components/notes/TaskStatusBadge.tsx:41`）
  - 前端任务 store：TaskPanel 消费的任务数据 store（实施时定位，可能为 stores/ 下 task 相关）
  - `components/notes/NotesTimelinePane.tsx:71-73`：`const [agentCollapsed, setAgentCollapsed] = useState(true)` × 2 + 注释「刷新回默认折叠」
- 关键决策回顾：改口仅限 plan/backlog（queued 后执行会话已按原类型创建，改了无意义→隐藏入口）；折叠展开仅改默认值，不持久化

## 计划改动
- [ ] `task-store.ts` 加 `updateTaskExecProfile(workspacePath, taskId, execProfile)`：mutateTasks 范式；校验任务存在且 status ∈ {plan, backlog}，否则抛错；写回 updatedAt
- [ ] `electron/main/tipc/tasks.ts` 加对应路由（入参 taskId + execProfile，返回更新后 Task）
- [ ] 前端任务 store 加调用方法与状态刷新（沿用面板现有刷新模式）
- [ ] `TaskDetail.tsx`：类型徽章处加切换入口（plan/backlog 才显示；形态自定：点击徽章循环切换或下拉，从简）
- [ ] `TaskPanel.tsx`：任务行徽章若加快捷切换则同步（可只在详情页提供，从简取舍）
- [ ] `NotesTimelinePane.tsx:72-73`：`useState(true)` → `useState(false)` × 2；:71 注释改「刷新回默认展开」
- [ ] 验证：`build:renderer` + `build:electron`；目验——plan 任务改口后 ListTasks/详情徽章变化；笔记栏两组默认展开

## 实施回填（做完后填）

### 实际改动
- 与计划差异：TaskPanel.tsx 未动（按「从简取舍」仅在详情页提供切换入口）；tipc 路由按既有架构经 task-service.ts 包装（补广播）非直连 store
- 改动文件清单：task-store.ts（+updateTaskExecProfile +re-export ExecProfile）、task-service.ts（+广播包装 +re-export）、tipc/tasks.ts（+updateCollabTaskExecProfile 路由）、stores/task-store.ts（+updateExecProfile）、TaskDetail.tsx（plan/backlog 态徽章变点击按钮循环 default⇄code-impl）、NotesTimelinePane.tsx（两处 useState(true)→false，注释同步）

### 给下一步的接力棒
- 关键签名 / 数据结构：`updateTaskExecProfile(workspacePath, taskId, execProfile): Promise<Task>`（store 层抛错校验 plan/backlog）；tipc `updateCollabTaskExecProfile → { task } | { error }`；前端 `useTaskStore().updateExecProfile(...): Promise<string | null>`（成功后 loadTasks 重拉）
- 下个 step 该从哪里继续：改口后管道查表即时生效已由 step1 承接（default=[]/code-impl=['staged-execution']），无需额外接线；若要列表行快捷改口，store 方法已就绪直接接 TaskCardItem
- 待办或已知限制：列表行无快捷改口（从简取舍）；execProfile 值仅编译期校验；目验（徽章变化/笔记栏默认展开）留主会话冒烟，build:renderer + build:electron 均通过
