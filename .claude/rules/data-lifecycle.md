---
paths:
  - "electron/main/agents/pi-session/**/*.ts"
  - "electron/main/agents/delegation-*.ts"
  - "electron/main/services/conversation-runtime-service.ts"
  - "electron/main/services/conversation-service.ts"
  - "electron/main/services/group-service.ts"
  - "electron/main/services/topic-lifecycle-service.ts"
  - "electron/main/tipc/conversation-runtime.ts"
  - "electron/main/tipc/conversations.ts"
  - "electron/main/tipc/group.ts"
  - "electron/main/tipc/renderer-handlers.ts"
  - "stores/conversation-store.ts"
  - "stores/group-store.ts"
  - "components/agent-chat/**/*.tsx"
  - "components/conversation-list/ConversationRow.tsx"
  - "components/conversation-list/ArchiveSection.tsx"
  - "components/group-list/GroupCard.tsx"
---

# 跨层状态与数据生命周期检查

涉及会话、子会话、权限或流式消息的状态变更，必须逐层检查：

1. 主进程事实源是否产生完整状态和错误原因。
2. tipc 路由或 renderer handler 是否保留类型并传递该状态。
3. Zustand store 是否能处理冷启动快照和增量事件，且不制造第二个乐观事实源。
4. 列表、聊天页和父会话统计是否消费同一份 store 快照。
5. 晚打开或快速切换时，attach 响应是否回放进行中消息、权限请求和运行态。
6. 成功、失败、取消、超时和未交付是否彼此可区分；只有正常结算且未正式交付可标记为 `no_delivery`。
7. 资源释放是否位于安全结算点；不得因中途状态或 `delivery:true` 打断仍在执行的 prompt。

新增或修改上述状态时，至少验证一次创建、运行首帧、晚打开、终态、父会话等待和冷加载路径；构建与 lint 通过不替代真实状态流验证。

## 删除、归档与迁移

涉及会话或话题删除、归档、恢复、启动迁移时，先列出并验收以下五类影响面：

1. 索引：conversation、group、tree、smart category 和前端 store 的可见性及引用一致性。
2. 文件：Harness 会话、旧 SDK 可定位历史、usage JSONL、组摘要、背景和共享区目录的保留或清理语义。
3. 引用：文件夹、分类、组卡和标签页/选中态不会保留已删除实体；归档只隐藏且保留持久化引用。
4. 运行时：归档前关闭关联 attachment；归档或删除后禁止 attach、发送、创建、分叉、派遣和其他写入。
5. 重复执行：删除与迁移在中途失败后可安全重试，不得先删索引再留下无法定位的工件。

归档状态只允许由对应话题的 `Group.archivedAt` 表达；不得重新引入会话级归档 API、字段或 UI。每次改动至少覆盖单会话删除、最后会话删除、话题归档/恢复、话题永久删除、运行中归档、旧数据迁移及重复迁移，并分别核查上述五类影响面。
