---
step: 3
title: 旧会话归档迁移与 runtime 收敛
status: pending
---

## 目标

在 Step 2 已落地新 Conversation 的中立 sessionId 生命周期后，一次性冻结归档所有旧 SDK Conversation，并移除 SDK 主会话 runtime 分流，使主会话 runtime 只路由到 pi。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 2 已在新 Conversation schema 中落地 `sessionId: string | null`，PiSession 已通过 Harness repo create/open 持久化并在首次创建后回写稳定 sessionId。
- `sdkSessionId` 的共享类型和新建/运行时传递已在 Step 2 收敛；本 step 只清理仍为旧 SDK Conversation 的存量数据与 runtime 残余分支。
- `conversation-runtime-service.ts` 的新 Conversation 已只走 PiSessionManager；需要审查并移除仅服务 SDK 主会话的 resume、close、release 与 delete 分支。
- 全局决策：迁移时现有全部 Conversation 都归档；旧 SDK JSONL 保留但不可回放、不可恢复、不可再参与摘要。

## 计划改动

- [ ] 增加可幂等识别的一次性 schema migration；对存量 Conversation 统一设置 `archivedAt` 和 `archiveReason: 'sdk-main-session-removed'`，清除或忽略遗留 `sdkSessionId`。
- [ ] 迁移必须原子写入并兼容已有 JSON 数据；重复启动不得重置已有用户归档时间或破坏新 Conversation。
- [ ] 明确迁移执行时机：在 Conversation 数据首次读写之前完成，且晚于配置目录准备完成；日志应说明迁移数量和跳过原因。
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
- sessionId 写回的调用点与时序：已由 Step 2 完成；本 step 只验证归档不会改写新 Conversation 的 sessionId。
- 已删除或保留的 runtime 路由：
- 下个 step 入口：
- 待办或已知限制：
