---
step: 1
title: 调度器重构 + triggerContext 贯通 + 精准提炼入口
status: in_progress
---

## 目标

`handleSessionClose` 换新签名（内部解析工作区、quitting 拦截、工作区过滤），`triggerContext` 从 fireTask 贯通到 task-executor，`triggerByConversation` 补脏判定成为精准提炼入口，group_digest 分支支持精准路径。

## 依赖上下文（接力棒输入）

- 关键现状（冲突核查已确认，行号基于 5917f26）：
  - `electron/main/services/scheduler/scheduler-service.ts:105` 现签名 `handleSessionClose(workspaceId?: string)`：不过滤工作区，workspaceId 只拼 triggerDesc 文案
  - `scheduler-service.ts` 全文无 quitting 机制、无 app import；`init()` 在 :47 附近，由 index.ts 启动时调用（早于任何窗口关闭事件）
  - `runtime/plan-runner.ts:9-13` `RunTaskOptions = { triggerReason; triggerDesc?; triggerId? }`；`runTask` 按 task.id 防重入（:26-29）
  - `runtime/task-executor.ts:58-63` `executeTask(task, hooks?: TaskExecuteHooks)`——**已有第二参数**，plan-runner 的 executeSingleTask（:203-207 附近）传 `{ onAgentTaskId }`；triggerContext 应并入此 hooks 对象
  - `task-executor.ts:64-72` group_digest 分支：`triggerScanAll(task.workspaceId)` + `whenGroupDigestIdle()` + summary 读 `getGroupDigestActivity().lastScan?.dirtyCount`
  - `electron/main/services/memory/group-digest-trigger.ts:381-395` `triggerByConversation(convId)`（死代码，无调用方）：getByIdGlobal → groupId → ws.path 后**直接 enqueue，无脏判定**
  - `electron/main/services/memory/group-digest-scanner.ts:127` `findDirtyGroup(wsId, wsPath, groupId, force)` → `DirtyGroup | null`；`DirtyGroup` 含 `hasExistingCard` 字段（enqueue 不需要透传，runOne 自己查）；runOne 出队时已自带 findDirtyGroup 脏判定（:208-209）——**前置脏判定只为「不脏时留日志」，防白跑已有兜底**
  - `conversation-service.ts` `getByIdGlobal(convId)` 返回 `{ conv, workspaceId }`
- 关键决策回顾：签名收敛为 `(conversationId: string)`（见 plan.md 全局决策）；精准分支 summary 不引用 `lastScan.dirtyCount`（精准路径不更新 lastScan，引用会显示旧数字）

## 计划改动

- [ ] `scheduler-service.ts` init() 处：`app.once('before-quit', ...)` 维护模块级 quitting 标志（index.ts 的 isQuitting 变量不可达）
- [ ] `scheduler-service.ts:105` `handleSessionClose(conversationId: string)`：quitting → return；`getByIdGlobal` 解析 workspaceId（查不到 → return）；遍历任务过滤 `task.workspaceId === workspaceId` + enabled + 带 `on_session_close` 触发器；fireTask 时 `triggerDesc` 带上会话信息、`opts.triggerContext = { conversationId }`
- [ ] `runtime/plan-runner.ts` `RunTaskOptions` 加 `triggerContext?: { conversationId: string }`，executeSingleTask 透传进 `TaskExecuteHooks`（与 onAgentTaskId 并列）
- [ ] `group-digest-trigger.ts:381` `triggerByConversation`：拿到 ws/groupId 后调 `findDirtyGroup(wsId, ws.path, groupId, false)`，null 则 `mainLogger.info('[group-digest] 会话所属组不脏，跳过', convId)` 后 return；非 null 才 enqueue（enqueue 参数与 triggerScanAll 的入队方式对齐）
- [ ] `runtime/task-executor.ts` group_digest 分支：`triggerContext?.conversationId` 存在时改调 `triggerByConversation` + `whenGroupDigestIdle()`，summary 写定性文案（如「已对会话所在组触发精准提炼，队列已清空」，不引用数字）；无 context 维持 `triggerScanAll` 原逻辑
- [ ] `bun run build:electron` 编译通过 + `bun run lint`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
