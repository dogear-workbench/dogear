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

主会话运行时已从 Claude Agent SDK 迁移到 `@earendil-works/pi-agent-core` 的 AgentHarness；`ConversationRuntimeService`（`conversation-runtime-service.ts`）统一通过 `getPiSessionManager()`（`electron/main/agents/pi-session/pi-session-manager.ts`）管理生命周期，不再有基于 SDK 的分流分支。

### 1. 会话生命周期管理
- **创建**：为对话创建 `PiSession`（`piSessionManager.createSession()` + `session.start()`），Harness 会话文件落 `<configDir>/workspaces/<workspaceId>/sessions/`
- **附加**：允许新的持有者（desktop/wechat-bot）绑定到同一 session，走 `retain()` 引用计数 +1
- **快照占位**：`attachConversation` 目前恒返回 `snapshot: []`（尚未实现晚加入重播，接口留了口子，见下方常见坑点）
- **关闭**：`detachAttachment()` 调 `release()`，引用计数归零即直接销毁（无跑步机保活）

### 2. 多附件绑定
```typescript
export interface ConversationRuntimeAttachment {
  attachmentId: string;           // 唯一标识符（UUID）
  sessionId: string;              // 绑定的 Harness sessionId
  permissionMode: string;         // pi 阶段一无权限模式概念，固定回传 'default'
  created: boolean;               // 该附件是否创建了这个 session
  snapshot: ExtendedSessionMessage[]; // 当前恒为 []，见上方「快照占位」
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

## 快照机制（当前未实现，接口留了口子）

`ConversationRuntimeAttachment.snapshot` 目前恒为 `[]`——`conversation-runtime-service.ts` 的 `attachConversation()` 尚未实现"晚加入窗口重播当前 turn 消息"的逻辑，只是把这个字段留在接口里。`electron/main/tipc/conversation-runtime.ts` 的 `attachConversationRuntime` 路由里确实有一段按 `result.snapshot.length > 0` 重播消息的代码，但因为 `snapshot` 永远是空数组，这段代码目前永远不会执行。如果要实现晚加入重播，需要在 PiSession 侧维护当前 turn 的消息缓存并在 `attachConversation` 时填充这个字段。

## 权限模式

pi 阶段一没有区分 holderType 的权限模式概念，`attachConversation` 返回的 `permissionMode` 固定回传字符串 `'default'`。权限确认逻辑由 `PiSession`（`electron/main/agents/pi-session/pi-session.ts` 的 `setPermissionMode`/`respondPermissionRequest`）统一处理，不按 desktop/wechat-bot 区分。

## 数据持久化

- 附件信息存储在内存中（runtimeService 单例）
- Harness sessionId 持久化到 `<configDir>/workspaces/<workspaceId>/sessions/`（`pi-session-repository.ts` 管理），`conversations.json` 的 `sessionId` 字段只存这个稳定标识，不存绝对路径
- 对话元数据持久化到 `conversations.json`
- 应用重启时，runtimeService 重新初始化（需要重新 attach）

## 常见坑点

1. **忘记 detach** → 会话不会关闭，资源泄漏（`release()` 归零才销毁）
2. **holderType 拼写** → 必须是 'desktop' 或 'wechat-bot' 之一
3. **误以为快照已实现** → 见上方「快照机制」，目前恒为空数组，晚加入窗口拿不到当前 turn 进行中消息
4. **把 attachConversation 当配置对象调用** → 实际是位置参数 `(conversationId, workspaceId, holderType, options?)`，不是 `{ conversationId, workspaceId, ... }`