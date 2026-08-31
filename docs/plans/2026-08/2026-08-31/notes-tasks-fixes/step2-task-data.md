---
step: 2
title: 任务数据层三栏重构
status: done
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
  - 前端两处最小兼容（计划未列但编译/运行必需）：`TaskStatusBadge.tsx` 的 `STATUS_CONFIG: Record<TaskStatus,...>` 补 plan 键（label「计划」，否则 TS 编译失败；旧 TASK_GROUPS 本地常量未加 plan 组，badge 不会出现）；`TaskPanel.tsx` 搜索 match 的 `t.planPath.toLowerCase()` 改 optional chain（planPath 可 undefined，设计文档边界项）。
  - `getTaskDetail` 对无 planPath 占位任务返回 `planContent: null` 不带 planError（占位是正常态，不报错样式）。
  - upsert 命中条件排除了 `deletedAt` 任务（回收站同标题任务不参与匹配，计划未提但语义显然）。
  - `CreateTaskInput.status` 加 `'plan'` 选项（计划未提，工具层 step4 用）。
  - grep 确认无 rejected→queued 存量调用方（旧转换仅存在于 ALLOWED_TRANSITIONS 定义），直接改 `rejected: ['plan']`。
  - `listDeletedTasks` 等全部读入口也接入 `ensureMigrated`（计划只说读时迁移，读入口统一接入保证一致性）。
- 改动文件清单：
  - `electron/main/services/task-store.ts` — TaskStatus 加 plan / TaskGroups 加 plan 键 / Task.planPath optional / TasksFile version 2 / ALLOWED_TRANSITIONS 新表 / ensureMigrated（模块级 Map per workspace 防并发）读时幂等迁移 / createTask upsert / moveTaskToBacklog / moveTaskToPlan / executeTask 与 completeTaskManually from 扩 ['plan','backlog']
  - `electron/main/services/task-service.ts` — 包装 moveTaskToBacklog / moveTaskToPlan（广播 tasksChanged）
  - `electron/main/services/task-queue.ts` — executeOne 开头验 planPath（缺失或 fs.access 失败 → safeReject「任务尚无 plan 文档，请先补文档再执行」，在 originSessionId 查询之前）
  - `electron/main/tipc/tasks.ts` — moveCollabTask({ workspacePath, taskId, to }) 路由（index.ts 是 ...tasksRouter 展开，自动生效）
  - `types/task.ts` — 镜像 TaskStatus / TaskGroups / Task.planPath?
  - `components/notes/TaskStatusBadge.tsx` / `components/notes/TaskPanel.tsx` — 前端最小兼容（见上）
  - `electron/main/services/task-store.test.ts` — 新增 6 测试：v1→v2 迁移幂等 / upsert 四场景 / 占位任务 / plan 态直接入队 / 三栏往返
  - `docs/codebase-map.md` — task-store / task-service / task-queue / types task / 前端 task-store 描述同步

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `TaskStatus = 'plan' | 'backlog' | 'queued' | 'running' | 'review' | 'done' | 'rejected'`；`TaskGroups` 七键（plan 第一）；`Task.planPath?: string`
  - 状态机：`plan→['backlog','queued','done']`、`done→['plan']`、`rejected→['plan']`、`backlog→['queued','done']`；`executeTask`/`completeTaskManually` from=['plan','backlog']
  - `createTask(ws, { title, planPath?, status?, originSessionId?, noteId?, skipPlanCheck? })`：upsert 先查 `status==='plan' && !deletedAt && title 相同` 命中则更新 planPath+updatedAt 返回（不改 status/originSessionId）；无 planPath 可建占位
  - tipc：`moveCollabTask({ workspacePath, taskId, to: 'backlog'|'plan' })` → `{ task } | { error }`；前端 store 尚无 moveTask action（step3 加）
  - 队列侧占位拦截已生效：无 planPath / 文件不存在 → rejected + result 提示
- 下个 step 该从哪里继续：step3 前端 UI——TaskPanel 分组顺序（计划 plan+rejected 合并 → 待办 → 排队 → 执行 → 待审核 → 已完成）、行内按钮（计划栏「移到待办」、已完成栏「移回计划」、占位「无文档」标识）、前端 stores/task-store.ts 加 moveTask action（client.moveCollabTask）、TaskStatusBadge plan 徽标已预留、TaskDetail baseDir 与按钮重排（设计文档 二/三 节）
- 待办或已知限制：
  - createTask autoExecute（status:'queued'）撞 plan 态同标题时会命中 upsert 且保持 plan 态（autoExecute 语义丢失）——step4 工具层改造时需处理（工具侧改为先 upsert 落 plan 再 executeTask，或 upsert 命中且传 queued 时补一步入队）
  - task-queue 占位拦截无单测（executeOne 私有且重依赖），以代码审查 + step4 工具侧双层拦截兑底
  - task-tools.ts / session-append-templates.ts 仍为旧术语旧语义（step4 范围）
