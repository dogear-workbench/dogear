---
step: 2a
title: Conversation 与 Harness Session 生命周期
status: pending
---

## 目标

为新 Conversation 建立中立 `sessionId` 的创建、持久化和恢复传递闭环，不替换现有裸 Agent 运行时。

## 依赖上下文（接力棒输入）

- `pi-session-repository.ts` 已提供按 workspaceId 的 Harness Session create/open 边界。
- `conversation-service.ts` 当前只保存 `sdkSessionId`，新 Conversation 还没有 Harness sessionId。
- `conversation-runtime-service.ts` 的 pi attach 路径位于 `attachPiConversation()`，当前只创建进程内 PiSession。
- 本步只建立数据生命周期；不得在此步把 `PiSession` 从裸 Agent 切换到 AgentHarness，也不得归档旧 Conversation。

## 计划改动

- [ ] 在 `conversation-service.ts` 的 ConversationIndex、ConversationCompat、create/createFork 与 compat 转换中加入 `sessionId: string | null`，兼容旧 JSON 缺字段读取为 null。
- [ ] 增加仅更新 Harness sessionId 的异步服务方法，按现有 safe JSON 写入语义更新 `updatedAt`。
- [ ] 扩展 PiSessionConfig，接收 workspaceId、已有 Harness sessionId 与首次创建回调，但保持裸 Agent 运行路径不变。
- [ ] 在 runtime 的 pi attach 路径读取 Conversation sessionId，传给 PiSession；PiSession 通过 repository create/open 验证生命周期，并在首次 create 后回写 sessionId。
- [ ] 明确 create 后回写失败和 open 失败的错误语义，不静默创建替代会话。
- [ ] 执行 `bun run build:electron`，人工确认新 Conversation 首次启动写入 sessionId、重开时传入原 sessionId。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- Conversation sessionId 字段与兼容输出：
- PiSessionConfig 的实际生命周期字段：
- create/open 与回写时序：
- 错误语义：
- 下个 step 入口：Step 2B 在此基础上新增 Harness adapter 并替换裸 Agent，不重复实现 Conversation 字段或 repository 生命周期。
- 待办或已知限制：
