---
step: 4
title: 会话内溯源条 + Tab 静默启动
status: done
---

## 目标

打开 agent 会话时能看到顶部溯源条"由 XX 派出：YY 任务"（可点跳转派出者）；agent 派出新会话时不自动激活 tab（避免打断当前操作）。

## 依赖上下文（接力棒输入）

- **Step 1 产出**：
  - `Conversation.contractMetadata` 字段可用
  - `getBySessionId` 可反查派出者

- **Step 2 产出**：
  - `CreateSession` 新工具存在，派出走它
  - Session ops 相关的 IPC 已迁移

- **关键决策回顾**：
  - 溯源条仅 `contractMetadata` 存在时显示
  - 派出者被删则显示"派出者已删除（原任务：xxx）"
  - Tab 平铺不区分主/子，静默启动只是"不激活"（tabs[] 还是加）

## 计划改动

### 溯源条组件

- [ ] 新建 `components/agent-chat/LineageBar.tsx`：
  - Props: `conversation: Conversation`
  - 逻辑：
    - `contractMetadata` 为空 → 返回 null（不渲染）
    - 有 → 从 conversation-store 或 tipc 查派出者会话（用 `parentSessionId`）
      - 派出者存在 → 显示 `← 由 [派出者标题] 派出：[task]`，整行可点，点击跳转到派出者会话（用 `openOrFocusConversation`）
      - 派出者不存在（已删）→ 显示 `← 派出者已删除（原任务：[task]）`，不可点，样式变灰
  - 样式：一行 `text-xs text-muted-foreground` badge，位置在会话内容顶部（AgentChat 的最上层，MessageList 之上）

- [ ] `components/agent-chat/AgentChat.tsx`：
  - 在 MessageList 之前插入 `<LineageBar conversation={currentConversation} />`
  - 需要能拿到当前 conversation 完整对象（应该已经有）

### Tab 静默启动

- [ ] 定位 agent 派出会话时 tab 激活的代码：
  - 检查 `stores/conversation-store.ts` 的 `loadConversations` 之后是否会触发 tab 激活
  - 检查 `stores/session-store.ts` 有没有在收到新 conversation 事件时自动 open+focus 的逻辑
  - 检查 `conversation-list/utils.ts` 的 `openOrFocusConversation` 什么时候被调
  - 检查 delegation-tools 内部创建 conversation 后是否触发前端事件

- [ ] 派出场景下：**只加 tab 到 tabs[]，不改 activeTabId**
  - 可能的做法：
    - 后端事件 `conversationCreated` 携带 `source: 'agent-delegation' | 'user-manual'`
    - 前端 session-store 监听事件，根据 source 决定是否 focus
    - source 为 agent-delegation → 只 push tab，不 focus
    - source 为 user-manual → push tab + set active

- [ ] 用户手动点列表 → 仍然正常 focus 切换（`openOrFocusConversation` 走原逻辑）

### Agent 会话接受用户输入

- [ ] 确认 `ChatInputArea.tsx` / `useSendMessage.ts` 在 agent 会话（`contractMetadata.createdBy = 'agent'`）里也是**默认能用**的
  - 如果因为某些 gate（比如 pendingState）不能用，需要调整
  - 用户在 agent 会话打字发送应该以 human 消息插入流（跟 Step 5 的 sender 区分呼应）

- [ ] 如果发现现有代码本来就允许，此项目 no-op

## 验收标准

- [ ] `bun run build:electron` + `bun run lint` 通过
- [ ] 手测：
  - 打开手动会话，顶部**没有**溯源条
  - 打开 agent 会话，顶部有溯源条，能看到派出者名 + 任务
  - 点击溯源条跳转到派出者会话（tab 切过去）
  - 删除派出者会话后，agent 会话溯源条变成"派出者已删除"
  - Agent 通过 CreateSession 派出新会话时，你当前的 tab 焦点不变（但列表能看到新会话）
  - 手动点列表新会话正常切换

## 实施回填（做完后填）

### 实际改动

**与计划差异**：
- 原计划没提要动 `SubAgentBanner`，实施中发现它跟 LineageBar 语义 100% 重合（都是"从哪里来"顶部横幅）：SubAgentBanner 基于 `role==='sub'` + `childrenByParent` 内存态（bridge 重启就丢），LineageBar 基于 `contractMetadata.parentSessionId` 持久化字段。同时保留会造成两个横幅叠加，所以本 step 顺带删除 SubAgentBanner，AgentChat 用 LineageBar 替换。
- **Tab 静默启动天然成立**，无需改代码：`delegation-bridge.startChild()` 只在后端创建 conversation，走 `conversationListChanged` 事件；前端 `stores/conversation-store.ts:808` 监听后只做 `loadConversations()`，不动 `activeTabId`。前端唯一激活 tab 的路径是用户点击列表 → `openOrFocusConversation()` → `openTab()`。所以派出会话默认就是"进列表但不抢焦点"。
- **Agent 会话接受用户输入**已 no-op：`ChatInputArea` / `useSendMessage` 对所有 conversation 通用，SubAgentBanner 移除后彻底无 gate。

**改动文件清单**：
- 新建 `components/agent-chat/LineageBar.tsx`
- 改 `components/agent-chat/AgentChat.tsx`：import 换 SubAgentBanner → LineageBar；渲染条件从 `selectedConv?.role === 'sub'` 改为 `selectedConv` 存在即渲染（LineageBar 内部按 contractMetadata 决定是否显示）
- 删 `components/agent-chat/SubAgentBanner.tsx`

### 给下一步的接力棒

- **关键签名**：
  - `LineageBar({ conversation, onOpenParent }: { conversation: Conversation; onOpenParent?: (parentConversationId: string) => void })`
  - 位置：`components/agent-chat/LineageBar.tsx`
  - 派出者查询走前端 store（`useConversationStore.conversations`），按 `sdk_session_id === contractMetadata.parentSessionId` 匹配。不需要 tipc。
- **视觉规范**（Step 5 可参考对齐）：
  - 派出者存在：蓝色 badge（`bg-blue-50 border-blue-200 text-blue-900` + dark 模式反色）+ `CornerDownRight` 图标
  - 派出者已删：灰色 badge（`bg-muted/50 border-border text-muted-foreground`）
  - 尺寸：`text-xs px-3 py-2 my-2 rounded-lg`，跟旧的 SubAgentBanner 视觉体量一致
- **待办 / 已知限制**：
  - LineageBar 只按 `sdk_session_id` 反查派出者（跨工作区查不到，因为 conversation-store 只装当前工作区的会话）。当前工作区隔离下这个行为合理，若未来支持跨工作区跳转再扩展
  - `selectConversation(parent)` 在 AgentChat.tsx 的 onOpenParent 里被调用，会走当前的 Tab 打开逻辑（openOrFocusConversation 那套）——已复用现有机制，无需额外处理
