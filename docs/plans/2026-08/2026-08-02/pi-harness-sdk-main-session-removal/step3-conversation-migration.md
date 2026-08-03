---
step: 3
title: Conversation Schema 与旧会话归档迁移
status: pending
---

## 目标

将 Conversation 持久化模型收敛为 Harness 的中立 sessionId，并在一次性迁移中冻结归档所有旧 Conversation，使主会话 runtime 只路由到 pi。

## 依赖上下文（接力棒输入）

- 前置 step 产出：PiSession 已通过 Harness repo create/open 持久化，能在创建或恢复后提供稳定的 sessionId。
- 现有 Conversation 模型在 `electron/main/services/conversation-service.ts` 使用 `sdkSessionId`，其镜像类型还存在于 `electron/main/types.ts`、`types/electron-api.ts` 等位置。
- `conversation-runtime-service.ts` 当前按 ModelProfile 的 apiFormat 在 SDK 与 pi manager 之间分流，且 SDK 路径支持 resume。
- 全局决策：迁移时现有全部 Conversation 都归档；旧 SDK JSONL 保留但不可回放、不可恢复、不可再参与摘要。

## 计划改动

- [ ] 将 Conversation 持久化和 IPC/renderer 共享类型中的主会话标识从 `sdkSessionId` 收敛为 `sessionId: string | null`，删除其 SDK resume 语义。
- [ ] 增加可幂等识别的一次性 schema migration；对存量 Conversation 统一设置 `archivedAt` 和 `archiveReason: 'sdk-main-session-removed'`，清除或忽略旧 `sdkSessionId`。
- [ ] 迁移必须原子写入并兼容已有 JSON 数据；重复启动不得重置已有用户归档时间或破坏新 Conversation。
- [ ] 明确迁移执行时机：在 Conversation 数据首次读写之前完成，且晚于配置目录准备完成；日志应说明迁移数量和跳过原因。
- [ ] 修改 Conversation 创建流程：新对话先无 `sessionId`，首次启动/发送时由 Harness 创建；将生成的 sessionId 写回 Conversation metadata。
- [ ] 修改 conversation-runtime-service：删除 SDK 主会话分流和 resume 逻辑，所有非归档主会话只交由 PiSessionManager 管理；保留 `PARSE_ARTICLE` 对 SDK worker 的独立使用。
- [ ] 调整会话 release/close 与对话删除前的数据读取，使不会再触发 SDK 主会话的 delete/resume API。
- [ ] 执行 `bun run build:electron`，使用旧数据副本验证迁移幂等、旧会话归档、新会话首次发送后写入 sessionId。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- Conversation 最终 schema 与 migration 标记：
- 归档旧会话的判定字段和 UI 可消费状态：
- sessionId 写回的调用点与时序：
- 已删除或保留的 runtime 路由：
- 下个 step 入口：
- 待办或已知限制：
