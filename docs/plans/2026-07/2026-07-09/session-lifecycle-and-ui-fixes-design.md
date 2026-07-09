# 会话生命周期解耦 + 状态同步 + UI 小修 设计

## 背景

用户反馈 4 个问题，其中 3 个交织在同一条主线上（会话生命周期与 UI 状态），另 1 个独立。

- **列表刷新缺失**：Agent 通过 `CreateSession` 派出的子会话不会出现在左侧会话列表，必须靠其他事件（切工作区/bot 建会话等）自然刷新才补上。
- **图标语义冲突**：agent 派出会话用 `Bot`（蓝/灰）、微信 bot 绑定也用 `Bot`（绿），同一图标承载两种语义，用户认为重复。
- **会话生命周期绑死 UI**：tab 关闭 → 组件 unmount → `useAgentSession` cleanup → detach 引用计数归零 → `_destroySession()` 强制终止 SDK 子进程。用户希望"tab 关不停任务，只有显式终止才停，重开继续渲染"。
- **状态标签脱节**：三处显示（tab 栏 / 列表行 / 聊天顶部 StreamingIndicator）各读各的源，"关 tab 后状态还在"是典型症状。
- **AskUserQuestion 无停止入口**：卡片只有"提交回答"按钮，用户想中途放弃只能等超时或去输入框停止（但输入框此时被 AskUser 占用）。

## 目标

1. **保活跑步机**：session 生命周期跟"是否在跑"绑，不跟"UI 是否挂载"绑。运行中的会话，关 tab 也不停；空闲状态下关 tab 才随之释放。重开 tab 通过 SDK resume 冷启动几百 ms 恢复。
2. **状态单一权威源**：后端一次事件同时更新全局粗粒度 Set 和会话内细粒度 pendingState，各处 UI 按需订阅但语义永远一致。
3. **左侧列表跟得上 agent 动作**：CreateSession 后自动刷新。
4. **图标唯一化**：agent 派出用 `Workflow`，Bot 只留给微信绑定。
5. **AskUserQuestion 加"停止"入口**：走 interrupt 路径，与输入框停止按钮语义一致。

## 架构

### 决策 1：会话生命周期 = "跑步机"模式（C 方案）

- **运行中保活**：只要 `QueryBasedSession` 有 pending message、正在 stream、或有挂起的权限/AskUser 请求，session 就活着，与 tab / UI 无关。
- **空闲随 tab 走**：session idle 且最后一个 UI 引用（tab）关闭时，才真正 `_destroySession()`。相当于"活跃时挂住，安静时收走"。
- **显式终止仍生效**：ChatInputArea 停止按钮、AskUserQuestionCard 新加的停止按钮、"删除对话"、"关闭工作区"、"退出 app" 都能强制 close。
- **重开续渲染**：关掉的 tab 重开时，如果 session 还在（跑动中被关的），直接续订消息流；如果已被 GC，走 SDK resume 从 `.dogear/conversations/{sdkSessionId}.jsonl` 恢复历史后订阅新事件。

**排除的选项**：
- A（永不自动 GC）：内存无上界，用户开一堆空闲 tab 就是隐患。
- B（idle N 分钟超时）：需要维护定时器 + 心跳，且要处理"正在等 AskUser 但看起来 idle"这种误杀风险。

### 决策 2：状态两层分工（不是三源合并）

后端一次 state 计算，前端两层视图订阅：

| 层 | 数据源 | 使用者 | 语义 |
|---|---|---|---|
| 全局粗粒度 | `conversation-store.runningConversationIds` / `pendingActionConversationIds`（Set） | tab 栏 StatusPulse、列表行 StatusPulse | "这个 conversation 是否在跑 / 是否等确认" —— boolean |
| 会话内细粒度 | session 内 `pendingState`（idle / running / flushing）+ 子会话/队列信息 | 聊天顶部 StreamingIndicator、ChatInputArea 发送/停止按钮切换 | "现在在干什么" —— 带文案 |

**关键**：这两层由**同一次后端事件**同步更新。QueryBasedSession 内部维护单一 state 机，任何状态变化时：

1. 更新自身 `pendingState`（emit `pendingCountChanged` / session 内 event）
2. 广播全局事件更新 `runningConversationIds` / `pendingActionConversationIds`

前后端映射保持一致，不会出现"输入框显示终止按钮但列表圆点已灭"。

**废弃字段**：
- `session-store.SessionTab.isStreaming`（历史补丁，只在 AgentChat 挂载时同步）
- `components/agent-chat/AgentChat.tsx:113-118` 那段 `useEffect` 同步逻辑

**替代**：
- `WorkspaceTabBar.tsx:105` 原来用 `tab.isStreaming` 判断"能否弹独立窗口"的地方，改读 `runningConversationIds.has(convId)`
- `WorkspaceTabBar.tsx:143-144` 的 `showPulse` 直接读 Set
- ChatInputArea 保持读 `pendingState`，不改

**事件顺序保证**：close session 时必须先清 `pendingState`（自然会 emit idle）再清 `runningConversationIds`，或者用一次原子事件同时更新，避免 UI 闪烁。推荐 close 时统一广播一个 `sessionClosed` 事件，前端 store 监听后同时清两个 Set + 前端不再依赖 session 内 event。

### 决策 3：CreateSession 后广播 `conversationListChanged`

`delegation-bridge.startChild()` 内在 `conversationService.create()` 之后加一行 `emitter.emit('conversationListChanged')`（跟前端"新建对话"按钮走同一路径）。前端 `conversation-store` 已订阅这个事件会自动 `loadConversations()`。

### 决策 4：图标 `Bot` → `Workflow`

`ConversationRow.tsx:112-122` agent 派出分支从 `Bot` 换成 lucide `Workflow`。颜色沿用蓝/灰。`Bot` 只留给 `isBotBound`（微信绑定）。

### 决策 5：AskUserQuestion 加停止按钮

`AskUserQuestionCard.tsx` 底部按钮组加 outline 变体"停止"按钮，位于"提交回答"左侧。onClick 走 `client.interruptQueryBasedSession({sessionId})`。已有的 abort → auto-deny 逻辑（`query-based-session.ts:517-523`）会处理挂起的请求，用户重发消息即开新一轮。

## 模块边界

**后端**：
- `electron/main/agents/query-based-session.ts` —— 生命周期解耦（不再靠引用计数强杀），close 语义梳理，state 单一源事件设计
- `electron/main/agents/tools/delegation-tools.ts` —— CreateSession 后 emit 列表刷新
- `electron/main/tipc/agent.ts` —— 可能需要新增 IPC `hasActiveSession(conversationId)` 供前端重开 tab 时判断"续订还是 resume"

**前端**：
- `stores/session-store.ts` —— 删 `SessionTab.isStreaming` 及 `updateStreaming` action
- `stores/conversation-store.ts` —— `runningConversationIds` / `pendingActionConversationIds` 事件订阅调整（对齐后端新广播路径）
- `components/agent-chat/AgentChat.tsx` —— 删同步 isStreaming 的 useEffect
- `components/agent-chat/hooks/useAgentSession.ts` —— cleanup 逻辑改为"不主动 close，只 unsubscribe"；attach 逻辑加"如果 session 已在则续订，否则新建/resume"
- `components/WorkspaceTabBar.tsx` —— `showPulse` / 弹独立窗口判断改读 `runningConversationIds`
- `components/conversation-list/ConversationRow.tsx` —— agent 图标改 `Workflow`
- `components/agent-chat/AskUserQuestionCard.tsx` —— 加停止按钮

**类型**：
- `types/electron-api.ts` —— SessionTab 去掉 isStreaming（如果类型在这暴露）

## 数据流

**关 tab（会话运行中）**：
```
用户点 tab 关闭 → session-store.closeTab → 从 tabs 移除
→ AgentChat unmount → useAgentSession cleanup → 不 close session，只 detach UI 订阅
→ QueryBasedSession 继续跑 → pendingState 仍变化 → runningConversationIds 仍在 → 列表行圆点仍亮
```

**关 tab（会话空闲）**：
```
用户点 tab 关闭 → session-store.closeTab → 从 tabs 移除
→ AgentChat unmount → useAgentSession cleanup → 判断 session idle → 触发 close
→ QueryBasedSession._destroySession → 广播 sessionClosed
→ store 清 runningIds → 列表行圆点灭
```

**重开 tab（session 还活着）**：
```
用户点会话行 → openOrFocusConversation → 新 tab → AgentChat 挂载
→ useAgentSession attach → 后端 hasActiveSession=true → 直接续订消息流
→ 前端渲染当前历史（从 SDK jsonl 或内存 message buffer）
```

**重开 tab（session 已 GC）**：
```
用户点会话行 → 新 tab → AgentChat 挂载
→ useAgentSession attach → 后端 hasActiveSession=false → 走 resume 路径
→ SDK 从 .dogear/conversations/{sdkSessionId}.jsonl 冷启动
→ 前端渲染历史 → 订阅新事件
```

**AskUser 停止**：
```
用户点卡片"停止"按钮 → client.interruptQueryBasedSession
→ QueryBasedSession.interrupt → query.interrupt + 清 pendingMessages
→ AskUser 请求 signal abort → 自动 deny
→ pendingState → idle → runningIds 清空 → 所有 UI 归位
```

## 错误处理 / 边界情况

- **保活期间应用退出**：session-store 在 app quit 时（Electron `before-quit` 或 workspace 切换）需要显式 close 所有 session，否则子进程泄漏。
- **保活但会话完成**（agent 跑完了）：pendingState 转 idle 后，检查是否还有 UI 引用；无则触发 close。这个"完成 → 检查引用 → close"的转换需要在 QueryBasedSession 里加钩子。
- **重开时 session 存在但消息 buffer 已被 GC**：SDK 内部消息在磁盘 jsonl，前端订阅新事件即可，历史通过 useMessageHistory 加载。这条路径已存在。
- **图标改 Workflow 后颜色是否变**：保持蓝色（agent 派出）/灰色（父会话被删）不变，只换图标。
- **AskUserQuestion 停止按钮的 disabled 态**：请求 requestId 已被 resolved 时按钮应该 disabled；但正常情况下卡片渲染时请求就是 pending，不会出这个态。留意事件到达顺序即可。

## 未决问题

1. **hasActiveSession IPC 是否必需**：可以让前端 attach 时后端自动判断（session 存在就返回现有实例，不存在就新建/resume），不必单独 IPC。实施时再看是否有前端提前判断的场景。
2. **保活会话在设置页/agent monitor 页的可见性**：`app/agent-monitor/page.tsx` 是否要显示保活但无 tab 的 session？留到实施时看。
3. **图标改动是否影响 SubAgentPanel 头部**：`SubAgentPanel.tsx` 头部也用 `Bot`。若那里的语义也是"agent 派出的会话面板"，应一起改成 `Workflow` 保持视觉一致；若是通用 agent 概念，可保留。实施时对齐。
