---
step: 1
title: 任务手动操作（状态机放宽 + 取消/完成/删除 + UI）
status: done
---

## 目标

用户可对任务手动操作：backlog 手动完成、queued/running 取消（running 中断执行会话）、任意状态删除（软删），列表行与详情页都有入口。

## 依赖上下文（接力棒输入）

- 设计文档：[../todo-in-notes-tiptap-taskops-design.md](../todo-in-notes-tiptap-taskops-design.md) 第三节
- 当前状态机：`electron/main/services/task-store.ts:65` `ALLOWED_TRANSITIONS`（backlog→['queued']；queued→['running','rejected']；running→['review','queued','rejected']；review→['done','rejected']；done→[]；rejected→['queued']）
- 现有 tipc 路由（`electron/main/tipc/tasks.ts`）：listCollabTasks / listDeletedCollabTasks / getCollabTask / reviewCollabTask / executeCollabTask / deleteCollabTask / restoreCollabTask / purgeCollabTask——软删已存在，本步只补 UI 入口与新语义路由
- 现有前端：`stores/task-store.ts` 有 executeTask 模式可参照；`components/notes/TaskPanel.tsx` 的 TaskCardItem 行 hover 只有 backlog「执行」按钮；`TaskDetail.tsx` 只有 backlog「执行」与 review「通过/打回」
- **开工先读**：`electron/main/services/task-queue.ts` 全文 + `task-service.ts`——确认队列 drain 怎么取任务（快照还是重查）、执行会话如何创建与中断（是否有 session 引用/interrupt 链路）、结果写回在哪

## 计划改动

- [ ] `electron/main/services/task-store.ts` ALLOWED_TRANSITIONS：backlog 加 'done'；queued 加 'backlog'；running 加 'backlog'
- [ ] `electron/main/tipc/tasks.ts` 新增两路由：
  - `completeCollabTask`（backlog→done，result 置「手动标记完成」）——内部走 transition，只允许 backlog 起点非法返回 error
  - `cancelCollabTask`（queued/running→backlog）：queued 直接迁移；running 先中断执行会话（按 task-queue 实际结构接线，如持有 session 则 interrupt、如只有 execSessionId 则经 PiSessionManager）再迁移；队列 drain 取到任务后重查状态非 queued 则跳过
- [ ] `electron/main/services/task-queue.ts` 竞态保护：结果写回（completeTask/rejectTask）前重查任务状态仍为 running，已被取消（回 backlog）则丢弃结果只记日志
- [ ] `stores/task-store.ts` 新增 completeTask / cancelTask / deleteTask（deleteTask 调 client.deleteCollabTask，成功后 loadTasks；失败 toast，模式照 executeTask）
- [ ] `components/notes/TaskPanel.tsx` TaskCardItem hover 操作：backlog 显「执行」、queued/running 显「取消」主按钮；`···` DropdownMenu 装「手动完成」（仅 backlog）与「删除」（任意状态，showConfirm「删除任务」轻确认）；手动完成也走 showConfirm 防误触
- [ ] `components/notes/TaskDetail.tsx` 状态按钮组：backlog=执行/手动完成/删除；queued、running=取消/删除；done、rejected=删除；review=通过/打回（现状）+删除；删除走 showConfirm
- [ ] 写操作后依赖现有 tasksChanged 广播刷新（确认 service 层已有，无则补）

## 验收

- 积压任务点「手动完成」→ 变已完成，result 显示「手动标记完成」
- 排队中任务点「取消」→ 回积压；队列继续跑下一任务不受影响
- 执行中任务点「取消」→ 执行会话中断、任务回积压；若恰好已写回结果（竞态）结果不覆盖已取消状态
- 任意状态删除 → 回收站三段视图可见可恢复
- `bun run build:electron` + `bun run lint` + 前端 tsc 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。cancel 时保留 execSessionId（取消后详情页仍可查看执行会话）；列表行删除成功后若删的是当前打开详情的任务则自动返回列表
- 改动文件清单：
  - `electron/main/services/task-store.ts`：ALLOWED_TRANSITIONS 放宽（backlog+'done'、queued+'backlog'、running+'backlog'）；新增 `completeTaskManually`（backlog→done，result='手动标记完成'）与 `cancelTask`（queued|running→backlog）
  - `electron/main/services/task-service.ts`：两个新原语的广播包装（completeTaskManually / cancelTask）
  - `electron/main/services/task-queue.ts`：executeOne 结果写回前重查状态非 running 则丢弃；safeReject 前重查状态非 queued/running 则跳过（消除取消竞态日志噪音）；导出 `interruptTaskExecSession(conversationId)`（经 PiSessionManager.getSessionIdByConversation 找 session 调 interrupt）
  - `electron/main/tipc/tasks.ts`：新增 `completeCollabTask`、`cancelCollabTask`（running 先 interrupt 再迁移）
  - `stores/task-store.ts`：新增 completeTask / cancelTask / deleteTask（模式照 executeTask，成功后 loadTasks）
  - `components/notes/TaskPanel.tsx`：TaskCardItem hover 主按钮 backlog=执行、queued/running=取消；`···` DropdownMenu 装手动完成（仅 backlog）+删除，均走 showConfirm
  - `components/notes/TaskDetail.tsx`：按状态分组按钮——backlog=执行/手动完成/删除，queued|running=取消/删除，done|rejected=删除，review=通过/打回+删除；删除成功后 onBack

### 给下一步的接力棒
- 关键签名 / 数据结构：`cancelCollabTask({ workspacePath, taskId })`（tipc）；`interruptTaskExecSession(conversationId)` 在 task-queue.ts 导出；前端 store 三方法均 `(workspacePath, taskId) => Promise<boolean>`
- 下个 step 该从哪里继续：Step 2（plan 路径链接）已完成，接着 Step 3 Tiptap 核心替换
- 待办或已知限制：取消 running 的中断只针对当前轮（interrupt 注入 cancelled 终局），若任务恰好同刻写回结果由写回前重查兕底；真机验收（点按钮验证流转）待用户进行
