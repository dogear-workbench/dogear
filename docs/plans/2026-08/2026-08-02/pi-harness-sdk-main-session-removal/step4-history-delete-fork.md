---
step: 4
title: 历史、删除与 Fork 的 TIPC/UI 适配
status: pending
---

## 目标

让前端通过 Conversation 读取 Harness 历史，正确呈现旧会话冻结状态，并完成 Harness session 的删除与原生 fork 闭环。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Conversation 已有 `sessionId`、旧会话可通过 archiveReason 识别、主会话只由 PiSessionManager 驱动。
- Harness repository 提供 open/delete/fork；其实际 API、树路径与 entry 格式以 Step 1 回填为准。
- 当前历史入口为 `getSdkSessionHistory`，相关 renderer hook 为 `components/agent-chat/hooks/useMessageHistory.ts`。
- 全局决策：前端和 TIPC 不得暴露 Harness 类型；旧 SDK 归档会话不回放 JSONL。

## 计划改动

- [ ] 新建或替换为以 `{ conversationId, workspaceId }` 为输入的通用会话历史 TIPC；由主进程读取 Conversation 并通过 Harness repo 还原当前 branch 的可展示历史。
- [ ] 实现 Harness history adapter：将 message entry 转为既有前端消息格式；compaction 仅映射为已有 compact boundary 或简洁元消息；model_change、label、custom 等非展示 entry 默认不进入消息流。
- [ ] 对缺少 sessionId 的新空会话返回空历史；对 `archiveReason: 'sdk-main-session-removed'` 返回明确的 legacy archived 状态，而非错误或空白歧义。
- [ ] 修改 `useMessageHistory` 和必要的 AgentChat 容器调用点，以 conversationId 请求历史；增加旧归档会话的冻结占位，禁用发送、编辑重发、分叉等操作入口。
- [ ] 修改 Conversation 删除链路：新 Harness 会话删除 metadata 前调用 repository delete；旧归档会话只删除 metadata，默认不删除旧 SDK JSONL 备份。
- [ ] 改造 Fork：使用 repository fork 创建新的 Harness session 与新的 Conversation metadata；第一版只从当前 leaf fork，除非现有 UI 已传递稳定 entry 定位信息。
- [ ] 确保 fork 产生的 sessionId 写入新 Conversation，原对话和分支各自独立恢复；定义 session 文件删除失败、fork 失败时的回滚顺序，避免 metadata 指向不存在的 session。
- [ ] 执行 `bun run build`，手动验证新会话恢复、旧会话归档占位、删除、当前末端 fork 和分叉后独立发送。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 通用历史 IPC 名称、输入输出类型：
- Harness entry → UI 消息的映射规则：
- 归档占位的组件和禁用入口：
- 删除与 fork 的实际事务/回滚顺序：
- 下个 step 入口：
- 待办或已知限制：
