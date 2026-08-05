---
paths:
  - "electron/main/agents/pi-session/**/*.ts"
  - "electron/main/agents/delegation-*.ts"
  - "electron/main/services/conversation-runtime-service.ts"
  - "electron/main/tipc/conversation-runtime.ts"
  - "stores/conversation-store.ts"
  - "components/agent-chat/**/*.tsx"
  - "components/conversation-list/ConversationRow.tsx"
---

# 会话运行时管理规则

## 背景

在 Dogear 中，单个对话可能由多个"持有者"（Holder）关联：
- **desktop**：主窗口中的标准聊天界面
- **wechat-bot**：微信 Bot 集成中的会话

为了支持这种多来源场景，需要一个统一的会话运行时管理层。

## ConversationRuntimeService 职责

主会话运行时已从 Claude Agent SDK 迁移到 `@earendil-works/pi-agent-core` 的 AgentHarness；`ConversationRuntimeService`（`conversation-runtime-service.ts`）统一通过 `getPiSessionManager()`（`electron/main/agents/pi-session/pi-session-manager.ts`）管理生命周期，不再有基于 SDK 的分流分支。

### 1. 会话生命周期管理
- **创建**：为对话创建 `PiSession`（`piSessionManager.createSession()` + `session.start()`），Harness 会话文件落 `<configDir>/workspaces/<workspaceId>/sessions/`
- **附加**：允许新的持有者（desktop/wechat-bot）绑定到同一 session，走 `retain()` 引用计数 +1
- **快照**：`attachConversation` 返回进行中消息、权限请求和 `running/pendingAction` 运行态；渲染层必须在 attach 响应后用既有 reducer 回放，不依赖延时广播
- **关闭**：`detachAttachment()` 调 `release()`，引用计数归零即直接销毁（无跑步机保活）

### 2. 多附件绑定
```typescript
export interface ConversationRuntimeAttachment {
  attachmentId: string;           // 唯一标识符（UUID）
  sessionId: string;              // 绑定的 Harness sessionId
  permissionMode: PiPermissionMode; // 当前会话的权限模式
  created: boolean;               // 该附件是否创建了这个 session
  snapshot: ExtendedSessionMessage[]; // 当前 turn 的进行中消息
  pendingPermissionRequests: Array<{ requestId: string; toolName: string; toolInput: unknown }>;
  sessionState: { running: boolean; pendingAction: boolean }; // attach 时的权威状态快照
}

export interface ConversationRuntimeState {
  conversationId: string;
  sessionId: string | null;       // 当前活跃的 Harness sessionId
  attachmentCount: number;        // 有多少个持有者绑定
  holders: RuntimeHolderType[];   // 持有者类型列表 ['desktop', 'wechat-bot']
}
```

### 3. 会话复用策略
- 同一对话的多个持有者共享同一个 Harness sessionId
- 创建者标记在 attachment 中（`created: boolean`）
- 只有最后一个持有者断开（`release()` 归零）时才销毁 PiSession

## 使用流程

`attachConversation` 是位置参数（不是配置对象）：`attachConversation(conversationId, workspaceId, holderType, options?)`，`options` 目前只有 `webContentsId`（窗口关闭时主进程主动 detach 用）。

### 主窗口 / 独立会话窗口（desktop 持有者）
```typescript
// 首次打开对话（tipc: attachConversationRuntime）
const attachment = await runtimeService.attachConversation(
  conversationId,
  workspaceId,
  'desktop',
  { webContentsId: context.sender.id },
);

// 与其他窗口共享同一个 Harness sessionId（不会重复创建），created 标记是否为本次新建
// 关闭对话时断开（tipc: detachConversationRuntime）
runtimeService.detachAttachment(attachment.attachmentId);
```

### 微信 Bot
```typescript
// Bot controller 中绑定对话
const attachment = await runtimeService.attachConversation(
  conversationId,
  workspaceId,
  'wechat-bot',
);
```

## 快照机制

`PiSession.getLiveSnapshot()` 是晚加入窗口的唯一事实来源，返回进行中消息、挂起权限请求和运行态。`attachConversationRuntime` 经 tipc 原样返回快照；`useAgentSession` 先把 `sessionState` 写入 conversation store，再将消息和权限请求交给 `streamReducer`。不要在前端为后台子会话乐观写 `runningConversationIds`，也不要用定时重试替代快照。

## 子会话终态与资源释放

`PiSession` 只在 Harness 已结算后发布 `PiSessionTurnResult`：`success`、`failed`、`cancelled`。`delegation-bridge` 只能根据这个结果更新 child status：成功但未 `delivery:true` 才能是 `no_delivery`；失败必须是 `failed` 且携带原因；中断保留 `cancelled` 或预先写入的 `timeout`。`SendMessage(delivery:true)` 不得 detach attachment，attachment 必须等结构化 complete 后释放。

## 权限模式

`attachConversation` 返回当前 `PiPermissionMode`。权限确认逻辑由 `PiSession`（`setPermissionMode`/`respondPermissionRequest`）统一处理；子会话默认模式取 `settings.subAgent.permissionMode`，再回退到全局设置。

## 数据持久化

- 附件信息存储在内存中（runtimeService 单例）
- Harness sessionId 持久化到 `<configDir>/workspaces/<workspaceId>/sessions/`（`pi-session-repository.ts` 管理），`conversations.json` 的 `sessionId` 字段只存这个稳定标识，不存绝对路径
- 对话元数据持久化到 `conversations.json`
- 应用重启时，runtimeService 重新初始化（需要重新 attach）

## 常见坑点

1. **忘记 detach** → 会话不会关闭，资源泄漏（`release()` 归零才销毁）
2. **holderType 拼写** → 必须是 'desktop' 或 'wechat-bot' 之一
3. **跳过 attach 响应中的快照** → 晚打开窗口会错过进行中消息、权限请求或运行态；必须经 store 和 reducer 回放
4. **把模型错误折叠为 no_delivery** → 只有 `success` 且从未交付才能标记为 no_delivery
5. **在 delivery:true 时释放 attachment** → 当前 prompt 可能仍在执行，必须等 complete 后回收
6. **把 attachConversation 当配置对象调用** → 实际是位置参数 `(conversationId, workspaceId, holderType, options?)`，不是 `{ conversationId, workspaceId, ... }`