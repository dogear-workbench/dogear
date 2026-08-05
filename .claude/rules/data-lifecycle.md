---
paths:
  - "electron/main/agents/pi-session/**/*.ts"
  - "electron/main/agents/delegation-*.ts"
  - "electron/main/services/conversation-runtime-service.ts"
  - "electron/main/tipc/conversation-runtime.ts"
  - "electron/main/tipc/renderer-handlers.ts"
  - "stores/conversation-store.ts"
  - "components/agent-chat/**/*.tsx"
  - "components/conversation-list/ConversationRow.tsx"
---

# 跨层状态生命周期检查

涉及会话、子会话、权限或流式消息的状态变更，必须逐层检查：

1. 主进程事实源是否产生完整状态和错误原因。
2. tipc 路由或 renderer handler 是否保留类型并传递该状态。
3. Zustand store 是否能处理冷启动快照和增量事件，且不制造第二个乐观事实源。
4. 列表、聊天页和父会话统计是否消费同一份 store 快照。
5. 晚打开或快速切换时，attach 响应是否回放进行中消息、权限请求和运行态。
6. 成功、失败、取消、超时和未交付是否彼此可区分；只有正常结算且未正式交付可标记为 `no_delivery`。
7. 资源释放是否位于安全结算点；不得因中途状态或 `delivery:true` 打断仍在执行的 prompt。

新增或修改上述状态时，至少验证一次创建、运行首帧、晚打开、终态、父会话等待和冷加载路径；构建与 lint 通过不替代真实状态流验证。
