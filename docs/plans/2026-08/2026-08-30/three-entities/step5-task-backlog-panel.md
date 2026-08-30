---
step: 5
title: 任务积压分组
status: done
---

## 目标

TaskPanel 加「积压」分组置顶，backlog 项可看来源笔记与 plan，一键「执行」进队列。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1/2 的 backlog 状态与 executeTask 路由；step3 的笔记跳转方式（若有复用）
- 现状：`components/notes/TaskPanel.tsx` 五状态分组列表 + TaskDetail；`stores/task-store.ts` 的 groups 结构

## 计划改动

- [x] `stores/task-store.ts`：groups 加 backlog 分组；加 `executeTask(taskId)` 动作（调 tipc，成功后刷新；tasksChanged 广播已订阅则自动）
- [x] `components/notes/TaskPanel.tsx`：「积压」分组置顶渲染——行内标题 + 来源笔记链接（noteId 有值时显示，点击切笔记 mode 打开该卡，悬空灰态）+ plan 路径 + 「执行」按钮（→ executeTask）
- [x] TaskDetail 若 backlog 任务点开详情，「执行」按钮同样可用（或列表行内就够，详情只读——实施时按现有交互模式取自然的一种，不留死按钮）

## 验收

- 迁移产生的 backlog 项（存量 1 条）可见、可见来源笔记与 plan
- 点「执行」→ 状态变 queued → 串行队列自动创建执行会话 → review 流程不受影响
- 现有五状态分组、review 徽章、通知深链不回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. TaskStatusBadge 补 backlog 徽章（计划未列）：STATUS_CONFIG 是 Record<TaskStatus,…>，step1 加 backlog 后一直缺 key（Vite/esbuild 不查类型未暴露），本次渲染积压徽章必须补
  2. TaskDetail 详情加「执行」按钮（计划的二选一取前者）：复用 review 按钮区交互模式，backlog 时常显；列表行内执行按钮用 hover 浮出（TodoItem/ConversationRow:100 同款），列表与详情两处入口均有，无死按钮
  3. NotesPanel 接 openNoteFromTasks 回调传 TaskPanel（计划隐含）：setMode('notes') + switchView('timeline') + setActiveNoteId，比 openNoteFromTodos 多一步 mode 切换
  4. store executeTask 返回 boolean，组件层 toast 错误反馈（store 内不引 sonner，与现有分层一致）
- 改动文件清单：
  - `stores/task-store.ts`：加 executeTask(workspacePath, taskId)（调 tipc executeCollabTask，成功后 loadTasks 即时刷新，tasksChanged 广播兜底）
  - `components/notes/TaskStatusBadge.tsx`：STATUS_CONFIG 补 backlog（violet）
  - `components/notes/TaskPanel.tsx`：TASK_GROUPS 加 backlog 置顶；backlog 行 meta 行（笔记 chip + plan 路径 truncate）+ hover 浮出「执行」按钮（行内局部 executing 防双击 + stopPropagation）；props 加 onOpenNote
  - `components/notes/TaskDetail.tsx`：backlog 状态显示「执行」按钮（handleExecute 调 store，失败 toast）
  - `components/notes/NotesPanel.tsx`：TaskPanel 挂载点接 onOpenNote={openNoteFromTasks}

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `useTaskStore.executeTask(workspacePath, taskId): Promise<boolean>`（组件 toast 错误，store console.error 记细节）
  - `TaskPanel props` 新增 `onOpenNote: (noteId: string) => void`
  - 积压徽章：`bg-violet-500/15 text-violet-600 dark:text-violet-400`
- 下个 step 从哪里继续：step6 顶栏分域搜索 + TodosView 残留清理；TaskPanel 无 query prop，若 step6 要任务分域过滤，照 TodosPanel 的 filterByQuery 模式在 renderGroups 前过滤 groups
- 待办或已知限制：
  - 悬空 chip 判定依赖 notes store 已加载（NotesPanel 挂载即拉 notes，不分 mode，实际无误判路径；加载窗口内短暂灰态）
  - 行内「执行」hover 才可见；详情常显按钮兜底发现性
  - 存量类型错误：TodoItem.tsx:73 的 Lucide title prop、agent-chat 若干——全量 tsc 有历史遗留，Vite 构建不查类型，与本次无关
