---
step: 4
title: 任务数据层与队列执行器
status: done
---

## 目标
主进程侧建成任务系统：Task 存储、状态机、串行队列（自动创建执行会话）、结果写回、系统通知、tipc 路由、agent 挂载工具。

## 依赖上下文（接力棒输入）
- 设计依据：`../notes-page-redesign-design.md` 架构第 3 节（Task 模型与生命周期）
- 前置 step 产出：无硬依赖（数据层独立；UI 在 Step 5）
- 现状事实：会话创建服务在主进程（`dogear__CreateSession` 工具底层）；执行会话提示词由 PiSession 体系组装（`pi-session.ts:374-454`）；通知用 Electron main `Notification`；工具注册模式见 `notes-tools.ts:337-342` `registerToolGroup`

## 计划改动
- [ ] 新 `electron/main/services/task-service.ts`：Task CRUD + 状态机 `queued|running|review|done|rejected`；存储 `.dogear/tasks.json`（对齐现有 JSON 存储惯例，查 notes 存储的读写模式照抄）；应用启动时把遗留 `running` 置回 `queued`
- [ ] 队列执行器（同文件或 `task-queue.ts`）：串行取 queued → 创建执行会话（复用主进程会话创建服务，启动上下文=任务定义+planPath+「按 plan 实施，结束时把结果摘要写回 Task」的提示词约定）→ running → 会话结束信号 → result 写回 → review + `Notification`（标题=任务名，点击聚焦应用）
- [ ] 执行会话「结束」判定：优先用会话停止信号 + 结果回写超时兜底；执行失败/卡死 → rejected + 通知（实施时按会话生命周期 API 选最可靠信号）
- [ ] tipc 路由：`tasks.list`（含状态分组）、`tasks.review`（通过/打回）、`tasks.get`（详情含 plan 内容读取）
- [ ] 新 `electron/main/agents/tools/task-tools.ts`：`dogear__CreateTask({ title, planPath, originSessionId })`（planPath 存在性校验，不存在 `isError: true`）、`dogear__ListTasks`；末尾 `registerTools()` 注册元数据；挂载主会话（`pi-session.ts:557` 旁照 notes 模式）
- [ ] 主进程改动后 `bun run build:electron` 验证编译

## 验收
- 会话内我调 `dogear__CreateTask` → `.dogear/tasks.json` 出现 queued 任务
- 队列自动创建执行会话并启动实施；会话结束后 Task 进 review、result 有摘要、系统通知弹出
- 前端（临时用 tipc 调试面板或日志）可见状态流转全链路
- plan 路径不存在时 CreateTask 报错不落盘
- 中断执行中的应用重启，任务回 queued

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `originSessionId` 不作为工具入参（计划字面是 `CreateTask({ title, planPath, originSessionId })`）：照 step3 source 决策由挂载点闭包注入 conversationId，不让 LLM 抄会话 ID
  - tipc 路由名带 `Collab` 前缀（`listCollabTasks`/`getCollabTask`/`reviewCollabTask`）：`listTasks` 等已被 scheduler 路由占用
  - 数据层拆 `task-store.ts`（纯逻辑零 Electron 依赖）+ `task-service.ts`（广播包装），对齐 notes-store/notes-service 惯例；service 层写操作后广播 `tasksChanged`（计划未列，供 Step 5 实时刷新，notes-service 同款惯例）
  - 执行会话拉起后自动 `setPermissionMode('autoExecute')`（无人值守不弹权限确认），任务轮结束后恢复原模式
- 改动文件清单：
  - 新 `electron/main/services/task-store.ts`：Task 类型/状态机/.dogear/tasks.json 读写（带锁事务 + 原子写）
  - 新 `electron/main/services/task-service.ts`：store 之上的广播聚合层
  - 新 `electron/main/services/task-queue.ts`：串行队列执行器（创建执行会话、结果提取、通知、启动恢复）
  - 新 `electron/main/agents/tools/task-tools.ts`：dogear__CreateTask / dogear__ListTasks + registerToolGroup
  - 新 `electron/main/tipc/tasks.ts` + `tipc/index.ts` 挂载
  - 改 `electron/main/tipc/renderer-handlers.ts`：tasksChanged 事件
  - 改 `electron/main/agents/pi-session/pi-session.ts`：主会话挂载 dogear-tasks（notes 旁）
  - 改 `electron/main/index.ts`：启动恢复 + 队列 kick
  - 新 `electron/main/services/task-store.test.ts`：状态机/存储 8 测

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `Task { id, title, status: queued|running|review|done|rejected, planPath, originSessionId?, execSessionId?, result?, createdAt, updatedAt }`（ISO 时间串；id 8 位 base36）
  - tipc：`listCollabTasks({ workspacePath }) → { groups }`；`getCollabTask({ workspacePath, taskId }) → { detail: Task & { planContent, planError? } }`；`reviewCollabTask({ workspacePath, taskId, action: 'approve'|'reject' }) → { task }`
  - 渲染层事件 `tasksChanged({ workspacePath })`，任务写操作后必发
  - 重挂队列：`getTaskQueue().kick()`；启动恢复走 `recoverAndStartTaskQueue()`
- 下个 step 该从哪里继续：TaskPanel UI（列表分组用 listCollabTasks，审核按钮用 reviewCollabTask，订阅 tasksChanged 刷新）；通知点击目前定位到执行会话（focusConversation），深链待审任务详情可在渲染层用 notificationId 前缀 `task-` 识别
- 待办或已知限制：
  - 执行结果摘要靠提示词约定（回复末尾 `<task-result>` 标签），无专用工具；未命中标签时回退本轮文本尾部（截 2000 字）
  - 执行超时硬编码 60 分钟（`task-queue.ts` EXEC_TIMEOUT_MS），未接设置项
  - rejected → queued 迁移服务层已开放（手动重挂用），UI 未暴露
  - 执行会话与普通主会话同构出现在会话列表，无特殊标识
  - 全量 bun test 有 8 个存量失败（settings-service 导出与测试不同步），与本 step 无关
