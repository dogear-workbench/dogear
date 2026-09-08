---
step: 1
title: 状态机与存储层
status: done
---

## 目标

TaskStatus 新增 `interrupted`，迁移表补新边，新增 `interruptTask` / `reportTaskResult`，删除文件心跳机制，启动恢复重写为无条件 running → interrupted。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无（首步）
- 当前关键文件状态：`electron/main/services/task-store.ts` 为存储真源（七状态机 + `.dogear/tasks.json` 读写，`mutateTasks` 串行化）；`electron/main/services/task-service.ts` 是广播包装层（写操作尾部 broadcastTasksChanged）
- 关键决策回顾：`interrupted` 与 `rejected` 分工见 plan.md「全局决策」第一条；`reportTaskResult` 必须原子（mutateTasks 闭包内完成查找+校验+迁移）

## 计划改动

- [x] `electron/main/services/task-store.ts:8` TaskStatus 联合类型加 `'interrupted'`
- [x] `electron/main/services/task-store.ts` TaskGroups 接口加 `interrupted: Task[]`；`listTasksGrouped` 填充
- [x] `electron/main/services/task-store.ts` ALLOWED_TRANSITIONS 按 design.md 迁移表更新：`running` 加 `interrupted`；`rejected` 加 `review`；新增 `interrupted: ['review', 'queued', 'plan', 'done']`
- [x] 新增 `interruptTask(workspacePath, taskId, reason)`：from `['running']` → `interrupted`，result=reason（走现有 transition，patch.result）
- [x] 新增 `reportTaskResult(workspacePath, execSessionId, result)`：mutateTasks 闭包内按 `t.execSessionId === execSessionId && ['running','interrupted','rejected'].includes(t.status)` 查找，命中 transition → `review`（result 为空时给占位文案，对齐现有 completeTask 的「（执行会话未输出结果摘要…）」），返回迁移后 Task；未命中返回 null
- [x] 删 `touchRunningTask`（含 JSDoc）
- [x] 重写 `recoverInterruptedTasks(workspacePath)`：无 staleMs 参数；闭包内所有非 deleted 的 running → interrupted，result=`应用重启时任务执行中断`（时间戳），返回 `{ recovered: number }`；不再有 skipped/12min 复查语义
- [x] `executeTask`（from 加 `interrupted`）、`completeTaskManually`（from 加 `interrupted`）、`moveTaskToPlan`（from 加 `interrupted`）放宽
- [x] 全文件清理：`markTaskRunning` 的 transition patch 不再写 `lastActiveAt`（TransitionPatch 类型同步删字段）；Task 接口 `lastActiveAt` 注释改为「已废弃，读时忽略」
- [x] `electron/main/services/task-service.ts`：透传 `interruptTask` / `reportTaskResult`（带广播）；删 `touchRunningTask` 导出与 `RECOVER_STALE_MS`；`recoverInterruptedTasks` 签名同步（recovered > 0 广播）
- [x] `types/task.ts`：TaskStatus / TaskGroups 镜像同步加 interrupted，注释「七状态机」改「八状态」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `reportTaskResult` 查找条件额外加 `!t.deletedAt`（软删任务不可被申报改写，防御性一行）
  2. `task-queue.ts` 最小适配实际删除了 `TASK_TOUCH_INTERVAL_MS`、`RECOVER_RECHECK_DELAY_MS` 两常量（后者仅被 skipped 复查块引用，删复查后必须一并删否则 unused）
  3. `task-service.ts` 的 `reportTaskResult` 仅在命中（返回非 null）时广播，null = 无状态变化不广播
  4. `task-store.test.ts` 同步适配（非新增测试文件）：删 touchRunningTask 导入与用例；两个旧 recover 用例（心跳跳过/lastActiveAt 回退）替换为「无条件 running→interrupted」用例；补 interruptTask / reportTaskResult 各一个用例锁定新签名行为。理由：旧断言与新语义矛盾且引用已删 API，bun test 必挂
- 改动文件清单：
  - `electron/main/services/task-store.ts`（主改动，见上）
  - `electron/main/services/task-service.ts`（删 touch/RECOVER_STALE_MS，透传 interrupt/report，recover 签名同步）
  - `types/task.ts`（TaskStatus/TaskGroups 镜像）
  - `electron/main/services/task-queue.ts`（最小适配：删心跳调用链与 skipped 复查块，recoverAndStartTaskQueue 改新签名）
  - `electron/main/services/task-store.test.ts`（测试对齐新语义，见差异 4）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `interruptTask(workspacePath, taskId, reason): Promise<Task>` — running → interrupted，result=reason
  - `reportTaskResult(workspacePath, execSessionId, result): Promise<Task | null>` — 原子查找+迁移 review；命中 running/interrupted/rejected（非软删）返回迁移后 Task，否则 null
  - `recoverInterruptedTasks(workspacePath): Promise<{ recovered: number }>` — 无条件 running→interrupted
  - ALLOWED_TRANSITIONS 新边：running→interrupted、rejected→review、interrupted→[review, queued, plan, done]
  - `lastActiveAt` 不再写入（markTaskRunning/TransitionPatch 已清理），存量字段保留不删
  - 已知中间态：前端 `components/notes/TaskStatusBadge.tsx` 的 `Record<TaskStatus,...>` 缺 interrupted key，`tsc -p tsconfig.json` 报 1 错——属于 step3 UI 范围，本步验证线（build:electron + lint）不受影响
- 下个 step 该从哪里继续：step2-queue-tool.md — 队列加固（buildExecutionPrompt 申报约定、写回前查已申报跳过、丢弃路径留痕、safeInterrupt、runExecutionTurn interrupt 超时强制放行）+ `dogear__ReportTaskResult` 工具（task-tools.ts，挂 dogear-tasks 组，校验归属；遇已 review 返回「已回写」；非执行会话 isError）+ 中断通知文案带申报引导句
- 待办或已知限制：启动恢复通知（逐任务/合并）未做——design.md 未决问题，归 step2；docs/codebase-map.md 中 task-store/task-service 描述已过时（七状态、touchRunningTask），待全链路完成后统一更新
