---
step: 2
title: 任务数据层三栏重构
status: pending
---

## 目标
主进程任务状态机加 `plan` 态、存量迁移、CreateTask upsert 占位语义、执行侧防御、`moveCollabTask` IPC 路由，为 step3 前端 UI 与 step4 agent 工具提供数据层签名。

## 依赖上下文（接力棒输入）
- 前置产出：无（首个任务侧步骤）。
- 当前关键文件状态：
  - `electron/main/services/task-store.ts` — 六状态机 `ALLOWED_TRANSITIONS`（rejected: ['queued']）、`TasksFile { version: 1 }`、`readTasksFile` 走 `safeJsonRead`、`CreateTaskInput.planPath` 必填且 createTask 内 `fs.access` 校验、`executeTask` from=['backlog']、`completeTaskManually` from=['backlog']
  - `electron/main/services/task-service.ts` — task-store 的广播包装层（tasksChanged）
  - `electron/main/services/task-queue.ts:104-130` — `executeOne`：靠 `originSessionId` 查会话建执行会话；无 planPath 存在性防御
  - `electron/main/tipc/tasks.ts` — 现有 listCollabTasks / getCollabTask / reviewCollabTask / executeCollabTask / deleteCollabTask / restore / purge
  - `types/task.ts` — 前端类型镜像（TaskGroups 六键、TaskStatus 六态）
- 关键决策回顾：upsert 仅匹配 plan 态同标题；version 1→2 读时迁移存量 backlog → plan；占位任务执行在队列侧拦截（工具侧 step4 再加一层）。

## 计划改动
- [ ] `electron/main/services/task-store.ts`：
  - `TaskStatus` 加 `'plan'`；`TaskGroups` 加 `plan` 键；`listTasksGrouped` 初始化补 plan 分组
  - `ALLOWED_TRANSITIONS` 更新：`plan: ['backlog', 'queued', 'done']`；`done: ['plan']`；`rejected: ['plan']`（先 grep `rejected` 相关调用确认无依赖 rejected→queued 的存量路径，有则一并改）
  - `TasksFile.version` 升 2；`readTasksFile` 读到 version 1 时迁移：所有 backlog 任务 status 置 'plan'（写回由既有 mutate 链路或读时直接升级——注意 `readTasksFile` 是纯读，迁移写入要走 `mutateTasks` 一次，模块级 readyPromise 防并发（参考 `services/scheduler/plan-store.ts` 的迁移模式）
  - `Task.planPath` 变 `string | undefined`；`CreateTaskInput.planPath` optional；createTask：有 planPath 时 `fs.access` 校验照旧，无则跳过；**upsert**：`mutateTasks` 内先查同 workspace `status === 'plan' && title === trimmedTitle` 的任务，命中则更新 planPath（若传入）+ updatedAt 并返回，未命中走新建
  - 新 transition 函数：`moveTaskToBacklog`（from ['plan'] → 'backlog'）、`moveTaskToPlan`（from ['done', 'rejected'] → 'plan'）
  - `executeTask` from 扩 `['plan', 'backlog']`；`completeTaskManually` from 扩 `['plan', 'backlog']`
  - `listDeletedTasks` / 软删链路对 plan 态无特殊处理（回收站按 deletedAt 排，无需改）
- [ ] `types/task.ts`：TaskStatus / TaskGroups / Task.planPath 同步镜像
- [ ] `electron/main/services/task-service.ts`：包装 `moveTaskToBacklog` / `moveTaskToPlan`（广播 tasksChanged）
- [ ] `electron/main/services/task-queue.ts` `executeOne`：取到任务后先校验 planPath——`!task.planPath` 或 `fs.access` 失败 → `safeReject(ctx, '任务尚无 plan 文档，请先补文档再执行')`（放 originSessionId 查询之前，占位任务最早拦截）
- [ ] `electron/main/tipc/tasks.ts`：加 `moveCollabTask({ workspacePath, taskId, to: 'backlog' | 'plan' })` 路由，调 service 层并返回 `{ task }` / `{ error }`；`electron/main/tipc/index.ts` 若为显式聚合则确认自动生效
- [ ] 前端调用面兼容排查：`stores/task-store.ts` / `components/notes/TaskPanel.tsx` 本步不改 UI，但 TaskGroups 多了 plan 键后前端 `filteredGroups[g.status]` 循环仍只遍历旧 TASK_GROUPS 六组——确认无 undefined 访问（`out` 初始化 `{...groups}` 保留 plan 数组即可，不炸）

## 验证
- `bun run build:electron` 编译通过
- 手造 `.dogear/tasks.json`（version 1 + backlog 任务若干）→ 重启/触发读 → 确认迁移为 version 2 + plan 态，二次读取不重复迁移
- upsert：同标题两次 createTask 只有一条任务且 planPath 被更新；不同标题正常新建
- 占位任务（无 planPath）executeTask 直接走队列 → 被拒（rejected + result 提示）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
