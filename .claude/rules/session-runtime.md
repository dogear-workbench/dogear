---
paths:
  - "electron/main/services/conversation-runtime-service.ts"
  - "components/agent-chat/**/*.tsx"
---

# 会话运行时管理规则

## 背景

在 Dogear 中，单个对话可能由多个"持有者"（Holder）关联：
- **desktop**：主窗口中的标准聊天界面
- **wechat-bot**：微信 Bot 集成中的会话

为了支持这种多来源场景，需要一个统一的会话运行时管理层。

## ConversationRuntimeService 职责

### 1. 会话生命周期管理
- **创建**：为对话创建新 SDK session（如果不存在）
- **附加**：允许新的持有者（desktop/wechat-bot）绑定到同一会话
- **共享快照**：当新持有者晚加入时，提供当前 turn 的消息快照供重播
- **关闭**：所有持有者都断开后关闭会话

### 2. 多附件绑定
```typescript
export interface ConversationRuntimeAttachment {
  attachmentId: string;           // 唯一标识符（UUID）
  sessionId: string;              // 绑定的 SDK session ID
  permissionMode: string;         // 权限模式（desktop/wechat 可能不同）
  created: boolean;               // 该附件是否创建了这个 session
  snapshot: ExtendedSessionMessage[]; // 当前 turn 的消息快照
}

export interface ConversationRuntimeState {
  conversationId: string;
  sessionId: string | null;       // 当前活跃的 SDK session
  attachmentCount: number;        // 有多少个持有者绑定
  holders: RuntimeHolderType[];   // 持有者类型列表 ['desktop', 'wechat-bot']
}
```

### 3. 会话复用策略
- 同一对话的多个持有者共享同一个 SDK sessionId
- 创建者标记在 attachment 中（`created: boolean`）
- 只有最后一个持有者断开时才关闭 SDK session

## 使用流程

### 主窗口（desktop 持有者）
```typescript
// 首次打开对话
const attachment = await runtimeService.attachConversation({
  conversationId,
  workspaceId,
  holderType: 'desktop'
});

// 获取会话快照（晚加入的渲染层重播）
const snapshot = attachment.snapshot;

// 关闭对话时断开
await runtimeService.detachConversation(attachmentId);
```

### 独立会话窗口
```typescript
// SessionWindowPage 中新打开对话
const attachment = await runtimeService.attachConversation({
  conversationId,
  workspaceId,
  holderType: 'desktop'
});

// 与主窗口共享同一个 sessionId（不会重复创建）
// 如果主窗口先打开，会得到已有的快照
// 如果独立窗口先打开，主窗口后来会看到快照
```

### 微信 Bot
```typescript
// Bot controller 中绑定对话
const attachment = await runtimeService.attachConversation({
  conversationId,
  workspaceId,
  holderType: 'wechat-bot',
  clearForkFields: false // Bot 不清理分叉字段
});

// Bot 消息到达时，获取最新快照供 UI 重播
const snapshot = runtimeService.getCurrentState(conversationId).snapshot;
```

## 快照机制

### 为什么需要快照？
- 独立窗口或 Bot 可能在主窗口已有消息的情况下晚加入
- 快照包含当前 turn（正在执行的请求）的所有消息
- 新加入的窗口重播快照，UI 状态与主窗口同步

### 快照内容
```typescript
snapshot: ExtendedSessionMessage[]
// 包含：
// - 用户最新输入（user message）
// - 正在执行的工具调用（tool_use）
// - 正在思考/生成的内容（assistant partial）
// - 权限请求（permission block）
// - AskUser 问题（askUser block）
```

### 快照更新时机
- 每当 Agent 推送新消息时，更新该对话的 attachment snapshots
- 新附件绑定时，得到最新的快照
- 与直播流同步，确保快照的时效性

## 权限和配置隔离

```typescript
// 不同持有者可能有不同的权限模式
const attachment = await runtimeService.attachConversation({
  conversationId,
  workspaceId,
  holderType: 'wechat-bot',
  permissionMode: 'bot' // 可能是特殊的 bot 权限模式
});

// runtimeService 维护每个 attachment 的权限配置
// QueryBasedSession 根据 attachment 的权限模式初始化 query() 参数
```

## clearForkFields 选项

当重新关联对话时（如从 orphan 导入）：
```typescript
// 清理分叉信息（用于"导入丢失的会话"场景）
await runtimeService.attachConversation({
  conversationId,
  workspaceId,
  clearForkFields: true // 删除 parentConversationId/forkMessageId
});

// Bot 不需要清理
await runtimeService.attachConversation({
  conversationId,
  workspaceId,
  holderType: 'wechat-bot',
  clearForkFields: false
});
```

## 数据持久化

- 附件信息存储在内存中（runtimeService 单例）
- SDK sessionId 持久化到 `.dogear/conversations/` JSONL 历史文件
- 对话元数据持久化到 `conversations.json`（sourceWorkspace 等字段）
- 应用重启时，runtimeService 重新初始化（需要重新 attach）

## 常见坑点

1. **忘记 detach** → 会话不会关闭，资源泄漏
2. **holderType 拼写** → 必须是 'desktop' 或 'wechat-bot' 之一
3. **快照延迟** → 新窗口可能收不到最新快照，需要监听 sessionMessage 事件
4. **权限模式不一致** → 不同持有者的权限设置可能冲突，需要通过 holderType 区分
5. **clearForkFields 误用** → 不是所有场景都需要清理，需要明确语义