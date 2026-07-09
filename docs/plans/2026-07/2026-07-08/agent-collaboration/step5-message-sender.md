---
step: 5
title: 消息 sender 视觉区分
status: done
---

## 目标

会话内的消息能看出是谁发的：手打 human 消息、agent 通过契约通道发来的消息各有明确视觉标记。这是"agent 协作可见"的最后一环——你进任何会话都能立刻看出这是不是别人（agent）在说话。

## 依赖上下文（接力棒输入）

- **Step 1 产出**：
  - `Conversation.contractMetadata` 可用于判断消息所在会话是否 agent 会话

- **Step 2 产出**：
  - `SendMessage(toSessionId, message)` 存在
  - 契约通道通信的消息通过 pendingMessages 队列进入目标会话
  - 需要在这条链路上带上 `senderSessionId`（来源标记）

- **关键决策回顾**：
  - Sender 类型：`'human' | { type: 'agent', sessionId: string }`（或字符串编码 `human` / `agent:xxx`）
  - 具体视觉待本 step 定

## 计划改动

### 消息数据结构扩展

- [ ] `components/agent-chat/types.ts`：Message 加字段
  ```ts
  interface Message {
    // ... 原有
    senderKind?: 'human' | 'agent';   // 未标记默认按 role 推断
    senderSessionId?: string;          // agent 时必填
    senderDisplayName?: string;        // 来源会话标题的快照（避免重命名/删除后拿不到）
  }
  ```
- [ ] 类型主进程镜像同步（如果 types/*.ts 有）

### 通信链路带上 sender

- [ ] `SendMessage` 工具（Step 2 已建）→ 服务层写入 pendingMessages 时，一并写入：
  - `senderKind = 'agent'`
  - `senderSessionId = fromSession.sdkSessionId`
  - `senderDisplayName = fromConversation.title`（拍照，避免后续变更）

- [ ] 用户在输入框打字发送 → useSendMessage 走原路径，消息自动是 `senderKind = 'human'`

- [ ] Agent 自己 query 产生的消息（agent 主动说话） → 不带 senderKind（因为就是当前会话的 agent 在说自己会话内的话，不算"跨会话"）

### UI 视觉

- [ ] `components/agent-chat/MessageItem.tsx`：
  - 判断消息 sender 类型：
    - 没标记 / role=user 无 senderKind → 当前用户手打（原样式）
    - `senderKind = 'agent'` → **agent 跨会话消息**：加个小徽章 `[Bot icon] 来自 [senderDisplayName]`，位置在消息内容前一行
    - `senderKind = 'human'`（在 agent 会话里由用户介入） → 加徽章 `[User icon] 你`（区分是用户不是 agent）

- [ ] 徽章样式建议：小字 `text-xs`，`text-muted-foreground`，一个 icon（12px）+ 名字，不占单独一行，跟消息头（时间/角色）挤在一起

### 视觉规则最终确认（本 step 定）

留三个选项在这里，实施时按整体观感选：

- 方案 A：仅徽章，不改消息卡背景色
- 方案 B：徽章 + agent 消息用不同浅色背景（比如 agent 消息淡蓝，human 消息淡绿）
- 方案 C：徽章 + 头像 icon 换（agent 消息头像是 Bot icon）

我倾向 **方案 A + C 结合**：徽章 + 头像 icon 换。背景色分层容易过重，dogear 现在的消息卡已经足够干净。

## 验收标准

- [ ] `bun run build:electron` + `bun run lint` 通过
- [ ] 手测：
  - 手动会话里，你打的消息就是原样（无徽章）
  - Agent 会话里，你打的消息带"你"徽章
  - Agent 会话里，父 agent 发来的消息带"来自 XX"徽章 + Bot icon
  - Agent 会话里，agent 自己回复的消息无徽章（就是普通 assistant 消息）
  - 派出者会话被重命名后，agent 会话历史消息里的 senderDisplayName 保持原样（快照，不联动）

## 实施回填（做完后填）

### 实际改动

**与计划差异**：
- 计划里原假设直接在 `Message` 类型上加 `senderKind` / `senderSessionId` / `senderDisplayName` 字段（前端内存态）。实施中发现底层走的是 SDK 的 `SDKUserMessage`，字段结构由 SDK 定义、我们塞不进自定义字段——加了也不会随 SDK JSONL 持久化，replay 时前端拿不到。跟用户确认后改走 **XML 标签编码到 content**（跟已有的 `<referenced_articles>` / `<quoted_snippet>` 一致），前端通过 `parseUserMessageReferences` 解析、剥离标签、映射到 `ParsedUserMessage` 的 sender 字段。类型改动落在 `ParsedUserMessage`（解析结果）而非 `Message`（原始存储）。
- 视觉方案选了 **A（仅徽章，不改背景色）**，头像/图标沿用消息卡外框；agent 徽章带 Bot 图标，用户介入徽章带 MessageSquare 图标，可选带绿色"交付"小标。
- **Agent 会话接受用户输入** 是 no-op：`ChatInputArea` / `useSendMessage` 对所有 conversation 通用，没有针对 agent 会话的 gate（Step 3+4 清理旧 SubAgentBanner 时已顺带确认）。

**改动文件清单**：
- 改 `electron/main/agents/delegation-bridge.ts`：`deliverMessage()` 把文本前缀 `[来自「XX」的...]` 换成 `<sender kind="agent" session_id="..." name="..." delivery="..."/>` XML 标签；文件末尾新增 `escapeXmlAttr()` 辅助函数
- 改 `components/agent-chat/types.ts`：`ParsedUserMessage` 加 `senderKind` / `senderSessionId` / `senderDisplayName` / `senderIsDelivery` 4 个可选字段
- 改 `components/agent-chat/utils.ts`：`parseUserMessageReferences()` 加 `<sender>` 标签解析，含 XML 反转义
- 改 `components/agent-chat/MessageItem.tsx`：加 `isAgentConversation` prop；在用户消息卡的引用芯片段前插入 sender 徽章渲染（agent 来源徽章 / 用户介入徽章 / 交付小标）
- 改 `components/agent-chat/AgentChat.tsx`：`<MessageItem/>` 调用处传 `isAgentConversation={selectedConv?.contractMetadata?.createdBy === 'agent'}`

### 给下一步的接力棒

- **XML 标签规范**：`<sender kind="agent|human" session_id="..." name="..." delivery="true|false"/>`
  - `kind` 必填；其他字段可选
  - `name` 属性值需 XML escape（`&` → `&amp;`，`<` → `&lt;`，`>` → `&gt;`，`"` → `&quot;`），解析时反转义
- **User 侧的 sender 标签**：目前 useSendMessage 手打消息**不注入 `<sender kind="human"/>` 标签**——前端 MessageItem 靠 "在 agent 会话 + 无 sender 标签 = 用户介入" 判断"你"徽章。如果未来跨设备/多用户场景需要区分具体用户身份，需要在 useSendMessage 里主动注入 `<sender kind="human" name="..."/>`。
- **回避的坑**：
  - `SDKUserMessage.content` 支持 string / blocks 两种；deliverMessage 用 string 路径拼接，前端 replay 时 SDK JSONL 会存原始 string，`parseUserMessageReferences` 从 string 里解析——路径闭环
  - sender 标签持久化跟 SDK 生命周期同步（跟 `<referenced_articles>` 一致），app 重启后 replay 依然能显示徽章
- **已知限制**：
  - `senderDisplayName` 是发送时的快照，派出者会话被重命名后不会联动更新（跟 step5 计划一致）
  - Agent 自己 query 产生的 assistant 消息不带 sender（不算跨会话），如果未来需要 assistant 徽章需另行设计
