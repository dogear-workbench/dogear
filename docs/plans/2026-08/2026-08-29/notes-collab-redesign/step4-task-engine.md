---
step: 4
title: 任务数据层与队列执行器
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
