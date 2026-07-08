# Agent 协作模式 实施计划

**设计文档**：[../agent-collaboration-design.md](../agent-collaboration-design.md)

**目标**：让 agent 派出的会话成为组内一等公民，UI 平级呈现，通信通过契约通道约束，用户能随时看到和介入。

**架构思路**：会话平摊到组（不引入父子树）；`contractMetadata` 存派出溯源；通信 API 从 delegation-tools 重构为通用 `SendMessage/CreateSession`；UI 靠图标 + 溯源条区分手动 vs agent 会话。

**涉及模块**：
- 数据层：`types/electron-api.ts` / `electron/main/services/conversation-service.ts`
- 通信层：`electron/main/agents/tools/delegation-tools.ts`
- 排序：`lib/conversation-sort.ts`（新建）
- Store：`stores/conversation-store.ts` / `stores/session-store.ts`
- UI：`components/conversation-list/ConversationRow.tsx` / `components/agent-chat/AgentChat.tsx` / `components/agent-chat/MessageItem.tsx`

## 步骤索引

- [ ] [Step 1: 数据层地基](./step1-data-foundation.md) — `contractMetadata` 字段 + service CRUD + 现有 delegation-tools 内部写入
- [ ] [Step 2: 通信 API 重构 + 契约通道校验](./step2-communication-refactor.md) — delegation-tools 改为通用 `SendMessage/CreateSession` + 通信许可校验 + 提示词更新
- [ ] [Step 3: 列表排序 + 图标区分](./step3-list-sort-icons.md) — DFS 排序纯函数 + `ConversationRow` 按 `createdBy` 换图标
- [ ] [Step 4: 会话内溯源条 + Tab 静默启动](./step4-lineage-tab-behavior.md) — 溯源条组件 + 派出时 tab 不抢焦点
- [ ] [Step 5: 消息 sender 视觉区分](./step5-message-sender.md) — `MessageItem` 显示消息来源（human / agent:sessionId）

**依赖顺序**：1 → 2 / 3（可并行）；4、5 依赖 1+2

## 全局决策

**数据模型：**
- `Conversation` 加可选字段 `contractMetadata?: ContractMetadata`
- 字段结构：`{ parentSessionId, task, expectedOutputPath?, createdBy: 'agent' | 'human' }`
- 手动创建的会话此字段为 `undefined`；agent 派出的会话必填
- 旧数据不迁移，加载时字段为 `undefined`，UI 按手动会话表现

**通信 API 重构：**
- 老工具（DelegateTo / SendMessageToChild / ReplyToChild / SubmitDelivery / WaitForDeliveries / ListChildren / StopChild）**全部替换**为新语义工具，不保留兼容
- 新工具（初步）：`CreateSession` / `SendMessage(toSessionId, ...)` / `WaitForMessage` / `ListLinkedSessions` / `StopSession`
- 命名不带 child/parent，体现平等
- 契约通道校验在 **service 层**（不在 IPC 层），保证任何调用路径都被拦

**列表排序：**
- 组内会话排序纯函数：`sortConversationsWithDFS(conversations: Conversation[]): Conversation[]`
- 输入原始列表（按 updatedAt 倒序）→ 输出重排后的列表
- 排序策略：手动会话按时间倒序；agent 会话按 DFS 紧跟派出者
- 派出者不在当前列表（已删除）→ agent 会话回落自然时间序位置

**UI 图标：**
- 手动会话：`MessagesSquare` (lucide)
- Agent 会话：`Bot` (lucide)
- 完成状态**不视觉区分**

**Tab 行为：**
- Agent 派出新会话时：conversation 加入列表 + tab 加入 tabs[] **但不激活**
- `activeTabId` 保持不变
- 用户在列表点击才切换 tab

**溯源条：**
- 仅 `contractMetadata` 存在时在会话头部渲染
- 派出者可查 → 显示"由 [名字] 派出：[task]"，可点跳转
- 派出者不可查 → 显示"派出者已删除（原任务：xxx）"

**消息 sender：**
- 类型扩展：`sender: 'human' | { type: 'agent', sessionId: string }` 或字符串编码
- Agent 消息带来源徽章（agent icon + 来源会话名简短）

**命名约定：**
- 派出时 `title` 参数由发起方 agent 起
- 兜底：`task.slice(0, 30)`

**跨 step 术语：**
- "手动会话" = `createdBy = 'human'`（或 `contractMetadata` 为空）
- "Agent 会话" = `createdBy = 'agent'`
- "派出者" = `contractMetadata.parentSessionId` 指向的会话
- "契约通道" = 两个会话之间存在派出关系（直接或递归），允许双向通信

## 未决问题（不阻塞实施，实施到相关 step 时定）

- Tab 状态保留策略（关闭 tab 再打开是否复原滚动/草稿）→ 独立特性，本次不做
- Agent 主动"叫住"用户的通知机制（未读/pulse/系统通知）→ 独立特性，本次不做
- 溯源条具体样式（badge / 卡片）→ Step 4 定
- 消息 sender 具体视觉（头像/背景色/徽章位置）→ Step 5 定
