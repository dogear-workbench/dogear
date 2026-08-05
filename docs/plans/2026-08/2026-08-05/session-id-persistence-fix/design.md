# 会话 session ID 持久化修复

## 背景

迁移到 pi-agent-core (AgentHarness) 后，`conversations.json` 里每个 conversation 有两个字段指向 session：

- `sessionId` — Harness session ID，用于历史加载（`getConversationHistory` → `buildSessionHistory(workspaceId, conv.sessionId)`）
- `sdkSessionId` — SDK 时代遗留，迁移后被 `onHarnessSessionCreated` 双写成同一个 Harness ID

运行中发现部分会话重启后历史记录消失。磁盘调查确认：

- 有内容的 jsonl 文件完好（如 707KB 的 `019fd0ee`）
- 但 `conversations.json` 的 `sessionId` 被覆盖成了空壳 ID（如 225B 的 `019fd122`）
- `sdkSessionId` 有时保留了正确值，有时也被覆盖——两个字段值不一致

直接原因：`onHarnessSessionCreated` 回调无条件覆盖 `sessionId`，当某次 attach 走了 create 分支（而非应该走的 open），新空壳 session ID 覆盖了有内容的旧 ID。

根本原因：`sessionId` 语义不明确——本应"创建后定死"的标识符，却被设计成"每次 create 都覆盖"。

## 目标

- `sessionId` 成为会话的唯一持久标识，**创建后永不变更**，直到会话被删除
- 删除 `sdkSessionId` 字段及其全部引用，消除双写混乱
- open 失败时直接报错，不静默 fallback 到 create
- 存量数据一次性迁移

## 架构

### 核心原则

```
新会话：conversation 创建时 sessionId=null → 首次 attach → create → 写入 sessionId → 之后永不再改
已有会话：sessionId 有值 → attach → open（恢复）→ 成功则用，失败则报错
不存在第三条路
```

### 排除的选项

- ~~open 失败 fallback 到 create~~：掩盖数据问题，且引入空壳覆盖风险
- ~~保留 sdkSessionId 做向后兼容~~：双字段是混乱根源，彻底删干净
- ~~onHarnessSessionCreated 加"已有值时不覆盖"守卫~~：治标不治本，正确的做法是回调本身就不存在覆盖场景

### Harness 自定义空间

Harness 的 `JsonlSessionRepo` 是纯文件管理层，不管 conversation ↔ session 映射。全部自定义逻辑在我们的封装层：

- `PiSessionRepository`：create/open/list/delete/fork 的薄封装
- `PiSession.start()`：open/create 决策（本次修改重点）
- `conversation-runtime-service.attachConversation()`：读取 `conversation.sessionId` 决定传给 start() 的 `harnessSessionId`
- `conversation-service`：conversations.json 的 CRUD

本次修改不触碰 Harness 库代码，全部在我们的封装层完成。

## 模块边界

### 删除 `sdkSessionId` 字段

**数据层**：
- `types/electron-api.ts` — `Conversation.sdkSessionId` 字段删除
- `electron/main/types.ts` — 镜像类型同步删除
- `electron/main/services/conversation-service.ts` — `create()` 不再初始化 `sdkSessionId: null`；`updateSdkSessionId()` 函数删除；`getBySdkSessionId()` 改为按 `sessionId` 查（或删除，视调用方情况）；`ConversationIndex` 类型同步

**运行时层**：
- `electron/main/services/conversation-runtime-service.ts` — `onHarnessSessionCreated` 回调改为只写 `sessionId`，且改为"create 后直接写一次"而非"回调"模式；删除对 `updateSdkSessionId` 的调用
- `electron/main/agents/pi-session/pi-session.ts` — `PiSessionConfig` 删除 `onHarnessSessionCreated` 回调；create 分支不再调回调，session ID 的写入职责移到 `attachConversation`
- `electron/main/agents/delegation-bridge.ts` — `ChildStateInternal.sdkSessionId` 及相关逻辑改为用 `sessionId`
- `electron/main/agents/tools/delegation-tools.ts` — `ListLinkedSessions`/`SendMessage` 等工具里展示的 `sessionId` 改为从 `conversation.sessionId` 取（而非 `sdkSessionId`）
- `electron/main/tipc/agent.ts` — `tipc.sdkSessionId` 相关字段/路由清理

**迁移层**：
- `electron/main/services/memory/group-digest-scanner.ts` — `conv.sdkSessionId!` 改为 `conv.sessionId`
- `electron/main/services/topic-lifecycle-service.ts` — `conversation.sdkSessionId` 从 session ID 集合中删除
- `electron/main/services/memory/migration-p3.ts` — 迁移逻辑里读旧 `sdkSessionId` 的地方适配

**前端层**：
- `components/agent-chat/LineageBar.tsx` — 如果用了 `sdkSessionId` 做溯源展示，改为 `sessionId`
- `types/electron-api.ts` 前端镜像同步

### sessionId 写入逻辑修改

**`conversation-runtime-service.ts` `attachConversation`**：

当前逻辑（有问题）：
```typescript
session = piSessionManager.createSession({
  harnessSessionId: conversation.sessionId ?? null,
  onHarnessSessionCreated: (harnessSessionId) =>
    Promise.all([
      conversationService.updateSessionId(...),
      conversationService.updateSdkSessionId(...),
    ]),
  ...
});
await session.start();
```

新逻辑：
```typescript
const isNewSession = !conversation.sessionId;
session = piSessionManager.createSession({
  harnessSessionId: conversation.sessionId,  // null=新建, 有值=恢复
  ...
});
await session.start();  // open 失败直接抛错，不 fallback

// 只有新建会话才写 sessionId，且只写一次
if (isNewSession) {
  const harnessId = session.getSdkSessionId()!;
  await conversationService.updateSessionId(workspaceId, conversationId, harnessId);
}
```

**`pi-session.ts` `start()`**：

```typescript
async start(): Promise<void> {
  const repository = getPiSessionRepository();
  const session = this.config.harnessSessionId
    ? await repository.open(this.config.workspaceId, this.config.harnessSessionId)
    : await (async () => {
        const { session: created, info } = await repository.create(this.config.workspaceId);
        this.config.harnessSessionId = info.id;
        return created;
      })();
  // ... 后续不变（拼 systemPrompt、组装工具、创建 adapter）
}
```

删除 `onHarnessSessionCreated` 回调。create 分支只更新 `this.config.harnessSessionId`（内存），磁盘写入由 `attachConversation` 在 start() 返回后执行。

### 迁移（一次性）

启动时扫描所有工作区的 `conversations.json`：
- 每条 conversation：`sessionId` 取 `sessionId ?? sdkSessionId ?? null`，然后删 `sdkSessionId` 字段
- 写回 conversations.json
- 迁移完成后不再处理（幂等：已无 sdkSessionId 的跳过）

### 数据修复（随本次修复一起做）

当前磁盘上有 6 个会话的 sessionId 指向空壳 jsonl。修复策略按可信度分两级：

**第一级：sdkSessionId 兜底（高可信）**

会话的 `sessionId` 指向空壳但 `sdkSessionId` 指向有内容的 jsonl。`sdkSessionId` 是首次 attach 时 `onHarnessSessionCreated` 写入的正确值，后来被空壳覆盖的只是 `sessionId`。

| 会话 | 当前 sessionId | sdkSessionId | 操作 |
|------|---------------|-------------|------|
| 开始实施(group_b694) | 空壳 | `019fd0ee`(707KB) | sessionId 修复为 `019fd0ee` |

**第二级：孤儿文件匹配（中可信）**

会话的 `sessionId` 和 `sdkSessionId` 都指向空壳，但磁盘上有同时间段创建的有内容孤儿 jsonl。通过 `contractMetadata.parentSessionId`、`createdAt` 时间窗口和 jsonl 内容里的首条用户消息匹配。

| 会话 | createdAt | 可能的孤儿 | 孤儿大小 | 匹配依据 |
|------|-----------|-----------|---------|----------|
| step1 话题数据模型 | 07:48:26 | `019fd0e5` | 631KB | 创建时间 07:48:26 完全吻合 |
| step3 UI | 08:09:58 | `019fd0f8` | 1MB | 创建时间 08:09:58 完全吻合 |
| step4 验收 | 08:24:18 | `019fd105` | 583KB | 创建时间 08:24:18 完全吻合 |

匹配依据：jsonl 文件名里的时间戳与会话的 `createdAt` 精确吻合（秒级），且这些孤儿不被任何其他会话引用。

**不修复的会话（无法可靠匹配）**：

| 会话 | 原因 |
|------|------|
| 排查权限 | sessionId/sdkSessionId 都空壳，无明确孤儿 |
| step1 PiSession重试 | 同上，可能是从未真正跑过的会话 |

这两个会话可能本身就没跑出实质内容（或内容极少），保持空壳状态，用户打开时会看到"会话历史文件缺失"的错误提示。

**实施方式**：写一个独立修复脚本（或在启动迁移里加一步），按上述映射修复 conversations.json 里的 sessionId 指针，然后删除所有 225B 空壳 jsonl 文件。

## 数据流

### 新建会话 → 发送消息

```
1. conversationService.create() → conversation.sessionId = null
2. 用户发消息 → attachConversation()
3. isNewSession = true (sessionId === null)
4. createSession({ harnessSessionId: null })
5. PiSession.start() → repository.create() → Harness 创建 jsonl 文件
6. session.start() 返回
7. updateSessionId(conversationId, session.getSdkSessionId())
8. sendMessage(task)
```

### 恢复已有会话

```
1. 重启软件，用户打开会话
2. attachConversation()
3. isNewSession = false (sessionId 有值)
4. createSession({ harnessSessionId: "019fd0ee-..." })
5. PiSession.start() → repository.open() → 恢复 jsonl
6. session.start() 返回
7. 不写 sessionId（已有值，不改）
8. 历史消息通过 getConversationHistory → buildSessionHistory(workspaceId, sessionId) 加载
```

### open 失败

```
1. attachConversation()
2. sessionId 有值
3. createSession({ harnessSessionId: "019fd..." })
4. PiSession.start() → repository.open() → 抛错 "Harness session not found"
5. session.start() 抛错传播
6. attachConversation catch → closeSession → throw error
7. 前端收到 { error: 'Harness session not found: ...' }
8. 用户看到错误提示，sessionId 未被覆盖
```

## 错误处理 / 边界情况

- **open 失败的错误信息**：应该对用户友好，比如"会话历史文件缺失或损坏，请重新创建对话"，而不是裸露的 "Harness session not found: 019fd..."
- **conversation.sessionId 有值但 jsonl 不存在**：open 失败报错，sessionId 保持不变（不覆盖），用户可以选择删除对话重建
- **迁移后 sdkSessionId 有值但 sessionId 为 null**：迁移步骤统一用 `sessionId ?? sdkSessionId` 兜底
- **迁移后两个字段都有值但不同**：以 sessionId 为准（它是 `getConversationHistory` 实际使用的字段）

## 未决问题

- `delegation-bridge.ts` 的 `ChildStateInternal.sdkSessionId` 改为用 `sessionId` 后，`getChildIdBySessionId` 等函数的查找逻辑是否需要同步调整——需要实际改时确认。
