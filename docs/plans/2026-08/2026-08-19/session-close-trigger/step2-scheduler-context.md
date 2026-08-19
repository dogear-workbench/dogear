---
step: 2
title: 调度器 handleSessionClose 重构 + triggerContext 贯通
status: pending
---

## 目标

`handleSessionClose` 换新签名（内部解析工作区、quitting 拦截、工作区过滤），`triggerContext` 从 fireTask 贯通到 task-executor，group_digest 分支支持精准提炼。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-dirty-check.md] `triggerByConversation(convId)` 已带脏判定，可直接作为精准触发入口
- 关键现状（本会话已调查）：
  - `electron/main/services/scheduler/scheduler-service.ts:105` 现签名 `handleSessionClose(workspaceId?: string)`：不过滤工作区，workspaceId 只拼 `triggerDesc` 文案
  - `scheduler-service.ts:260` `fireTask(taskId, opts: RunTaskOptions)` → `this.runner.runTask(task, opts)`；`RunTaskOptions` 定义位置执行时确认（大概率在 `runtime/plan-runner.ts`）
  - `runtime/task-executor.ts` `runBuiltinTask` 的 `group_digest` 分支：现状 `triggerScanAll(task.workspaceId)` + `whenGroupDigestIdle()` + summary「扫描发现 N 个待提炼组，队列已清空」
  - `conversation-service.ts` `getByIdGlobal(conversationId)` 返回含 `workspaceId` 与 `conv.groupId`（结构执行时核对）
  - `getSchedulerService()` 懒加载单例，index.ts 启动时 init 接线
- 关键决策回顾：签名收敛为 `(conversationId: string)` 是为了让 step3 的 pi-session-manager 只依赖调度器单入口（见 plan.md 全局决策）

## 计划改动

- [ ] `scheduler-service.ts` 构造/init 处：`app.once('before-quit', ...)` 维护模块级 quitting 标志（index.ts 的 isQuitting 变量不可达）
- [ ] `scheduler-service.ts:105` `handleSessionClose(conversationId: string)`：quitting → return；`getByIdGlobal` 解析 workspaceId（查不到 → return）；遍历任务过滤 `task.workspaceId === workspaceId` + enabled + 带 `on_session_close` 触发器；fireTask 时 `triggerDesc` 带上会话/组信息、`opts.triggerContext = { conversationId }`
- [ ] `runtime/plan-runner.ts` `RunTaskOptions` 加 `triggerContext?: { conversationId: string }`，确认透传到 `executeTask`
- [ ] `runtime/task-executor.ts` `group_digest` 分支：`triggerContext?.conversationId` 存在时改调 `triggerByConversation`（step1 产物）+ `whenGroupDigestIdle()`，summary 写「精准提炼会话 xxx 所在组，队列已清空」一类文案；无 context 维持 `triggerScanAll` 原逻辑
- [ ] `bun run build:electron` 编译通过 + `bun run lint`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
