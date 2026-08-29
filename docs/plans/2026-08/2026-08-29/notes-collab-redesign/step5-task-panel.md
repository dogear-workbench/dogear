---
step: 5
title: 任务视图
status: done
---

## 目标
TaskPanel 上线：任务列表按状态分组、详情聚合（plan 渲染/执行会话链接/结果/审核），顶栏 `[任务]` tab 接通，通知点击深链待审任务。

## 依赖上下文（接力棒输入）
- 设计依据：`../notes-page-redesign-design.md` 架构第 4 节
- 前置 step 产出：[step2] 笔记页骨架顶栏有 `[任务]` 占位 tab、列表|详情 300px 骨架；[step4] tipc 路由 `tasks.list/get/review` 与 Task 数据结构（签名见回填）
- 现状事实：任务视图复用 NotesPanel 的列表|详情空间（互斥显示，同 app/page.tsx 挂载模式）

## 计划改动
- [ ] 新 `components/notes/TaskPanel.tsx`：
  - 列表：按 `queued/running/review/done(+rejected)` 分组渲染任务卡片（标题+状态徽章+时间）
  - 详情：任务标题+状态徽章；plan 文件内容渲染（markdown 渲染组件查现有复用）；执行会话链接（有 execSessionId 时显示，点击跳会话 tab——复用 Step 3 来源跳转的机制）；result 摘要；`review` 态显示 `[✓ 通过] [↩ 打回]`（tipc `tasks.review`），其余态只读
  - rejected 态显示打回态样式；重挂不做（用户改后由 agent 重新 CreateTask）
- [ ] `NotesPanel.tsx`：顶栏 `[任务]` tab 接通 TaskPanel（互斥显示，与笔记视图切换）
- [ ] 通知点击深链：主进程通知 → 聚焦应用 → 激活笔记页任务视图 → 选中该待审任务（渲染进程路由，查现有 tab 激活链路）
- [ ] 待审徽章：顶栏 `[任务]` tab 上显示 review 态计数（0 时隐藏）

## 验收
- 顶栏切换笔记/任务视图正常，骨架一致
- 从挂载到执行到待审到通过/打回，全程在任务视图可见状态流转
- 详情内点执行会话链接能跳到该会话
- 通知点击落到待审任务详情
- review 计数徽章随状态增减

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 列表分组渲染为 5 组（queued/running/review/done/rejected 各自独立），计划字面「done(+rejected)」——rejected 并入 done 会让失败与成功任务混排，独立「已打回」组更清晰
  2. 打回操作加 showConfirm 二次确认（通过不加）：打回即审核终结，误触会丢失当次 review 机会
  3. 详情拆为独立 TaskDetail.tsx（TaskPanel.tsx 专注骨架+列表），避免单文件逼近 300 行红线；TaskDetail 以 key={taskId} 挂载，换任务即重挂载
  4. 审核成功后用 tipc 返回的 task 本地同步 detail，列表刷新由 tasksChanged 广播兜底
  5. plan/结果渲染复用 MarkdownRenderer（react-markdown，与聊天消息同源）
- 改动文件清单：
  - 新 `types/task.ts`（镜像主进程 Task/TaskGroups/TaskDetail）
  - 新 `stores/task-store.ts`（groups/activeTaskId + loadTasks/subscribeTasksChanged，仿 notes-store）
  - 新 `stores/task-focus-store.ts`（深链请求 focusReq{taskId,seq}，seq 递增不需清除）
  - 新 `components/notes/TaskStatusBadge.tsx` / `TaskPanel.tsx` / `TaskDetail.tsx`
  - 改 `components/notes/NotesPanel.tsx`（任务分支接通 TaskPanel、[任务] 按钮 review 徽章、激活时惰性 loadTasks+订阅广播、深链请求切 mode）
  - 改 `app/page.tsx`（监听 focusTask：切工作区→切 NOTES tab→requestTaskFocus）
  - 改 `electron/main/tipc/renderer-handlers.ts`（新 focusTask 事件）
  - 改 `electron/main/services/session-notification-service.ts`（SessionNotificationInput 加 taskId；taskId 通知跳过独立窗口分支，直接主窗口深链）
  - 改 `electron/main/index.ts`（setLocateCallback 按 taskId 分流 focusTask/focusConversation）
  - 改 `electron/main/services/task-queue.ts`（notify 携带 taskId）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `useTaskStore`（stores/task-store.ts）：`{ groups, loading, loadedWorkspacePath, activeTaskId, loadTasks(wsPath), subscribeTasksChanged(): () => void, setActiveTaskId }`
  - `useTaskFocusStore`（stores/task-focus-store.ts）：`{ focusReq: { taskId, seq } | null, requestTaskFocus(taskId) }`；消费方 NotesPanel（切 mode）与 TaskPanel（选中任务）各自响应同一请求
  - 深链全链路：task-queue notify(taskId) → 通知点击 → session-notification-service（taskId 直达主窗口）→ index.ts 分流 `focusTask({ taskId, workspaceId })` → page.tsx 切工作区+切 NOTES tab+requestTaskFocus
  - 会话跳转复用 `jumpToSourceConversation({ conversationId, title })`（lib/reference-guard.ts），执行会话链接同款
- 下个 step 该从哪里继续：本计划全部 step 完成，闭环
- 待办或已知限制：
  - review 徽章计数依赖 NotesPanel 激活后加载过任务列表（与 notes 惰性加载同模式）；从未打开笔记页时主进程通知是唯一提醒通道
  - rejected 任务无 UI 重挂入口（按全局决策：重挂 = 用户改 plan 后让 agent 重新 CreateTask）
  - TaskPanel 列表骨架与笔记视图 aside/分隔条约 25 行平行重复（两视图解耦的取舍）
  - 存量未动：执行超时 60min 硬编码、执行会话无特殊标识（step4 遗留）
