---
step: 4
title: 存活可视化
status: done
---

## 目标
会话存活状态（含停止态）对用户可见：列表左侧竖线常亮表示存活；等待交付动效从主聊天流挪到 MessageMinimap 同位置侧边区域。

## 依赖上下文（接力棒输入）
- 设计：`../delegation-lifecycle-fix-design.md` 架构第 4 条
- 现状机制：ConversationRow.tsx:119 左侧竖线（选中态指示）；:34 running 橙点 pulse；:65 runningConversationIds 集合驱动
- AgentChat.tsx:138-140 isWaitingForChildren（settled ∧ awaitCount>0）→ :442,:549 传给 StreamingIndicator 显示「等待 N 个交付」+ 中断按钮
- MessageMinimap.tsx 位于聊天区右侧；renderer-broadcast.ts 是既有主进程→渲染层广播通道（try/catch 包裹）
- 关键决策回顾：竖线=存活语义（活着即亮，等待计数归零且空闲/销毁后熄灭）；动效位置与小地图同列，不与消息流打架

## 计划改动
- [x] electron/main：PiSessionManager 存活集合（内存 Map）变化时经 renderer-broadcast 广播（跟随既有模式定全量/增量）
- [x] stores/conversation-store.ts：aliveSet 维护 + IPC 订阅
- [x] ConversationRow.tsx：竖线条件扩展为存活态（颜色/粗细区别于选中态与 running 橙点，出两版对比后定稿）
- [x] AgentChat.tsx / StreamingIndicator / MessageMinimap 区域：等待交付动效迁移到小地图同位置侧边（中断按钮随迁或保留在输入区，实施时定）
- [x] 验证路径：父会话等待子会话期间关掉 UI 再看列表（竖线仍亮，若开着其他窗口）；子会话全部终态后竖线熄灭；等待期间小地图侧边有动效、主聊天流无等待文案

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 存活语义收窄：不是「session 在内存就亮」，而是「在内存 ∧ (isRunning ∨ isHeld)」——UI 开着的空闲会话（refCount>0、不 running、无 hold）不亮，避免常开 tab 全亮竖线稀释信号；关掉 UI 仍被 bridge hold 的父会话、后台 orphan running 的会话亮（核心目标场景）
  - 广播粒度定全量：PiSessionManager 派生 conversationId 集合，内部 sorted-join diff 变化才发（跟随 sessionStateChanged「状态跟上次不同才 emit」模式），前端整体替换 Set
  - 中断按钮定随迁：点击侧边动效即中断等待（title 有提示）；ChatInputArea 的「等待子会话交付中 · 可继续对话」文字状态行保留（非聊天流非动效）
  - 竖线视觉定稿 emerald-500 常亮 w-0.5（两版对比见共享区 step4-delivery.md）
  - 冷启动初值：新增 tipc 查询 getAliveConversations，窗口冷启动/刷新时主动拉全量（主进程不会对已存在的状态补播）
- 改动文件清单：
  - electron/main/services/renderer-broadcast.ts（+broadcastAliveConversations）
  - electron/main/agents/pi-session/pi-session-manager.ts（getAliveConversationIds + broadcastAliveSet diff + 5 个触发点：sessionStateChanged/settled/acquireHold/releaseHold/bindConversation/_destroySession）
  - electron/main/tipc/renderer-handlers.ts（+aliveConversationsChanged 事件）
  - electron/main/tipc/delegation.ts（+getAliveConversations 查询）
  - stores/conversation-store.ts（aliveConversationIds + setAliveConversations + 订阅 + 冷启动拉初值）
  - components/conversation-list/ConversationRow.tsx（竖线：pending 蓝 > running 橙 > 存活绿）
  - components/agent-chat/StreamingIndicator.tsx（瘦身，删等待交付分支/props）
  - components/agent-chat/LiveTail.tsx（删相关 props 透传）
  - components/agent-chat/AwaitingDeliveryIndicator.tsx（新增：侧边轨道动效，点击中断）
  - components/agent-chat/AgentChat.tsx（轨道挂动效组件、LiveTail 去 props、isWaitingForChildren 仅剩输入区状态行在用）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `manager.getAliveConversationIds(): string[]`（conversationId 维度；session 在内存 ∧ (isRunning() ∨ isHeld)）
  - `broadcastAliveConversations(conversationIds: string[])`（renderer-broadcast，全量）
  - RendererHandlers.`aliveConversationsChanged`：`{ conversationIds: string[] }`
  - tipc `getAliveConversations` → `{ conversationIds, error? }`（delegationRouter）
  - store：`aliveConversationIds: Set<string>` / `setAliveConversations(ids)`
- 下个 step 该从哪里继续：本计划 4 步已全部完成，无下一步
- 待办或已知限制：
  - 存活集合为内存态，应用重启即空（与设计一致，靠 recoverAndStartTaskQueue 兑底）
  - 父会话被自动调起后的新 session 会重新亮（bindConversation + reacquireParentHolds 触发广播），调起前后可能有短暂熄灭窗口，属真实状态
  - ChatInputArea 状态行与侧边动效并存（前者 settled 态文案、后者 awaitCount>0 即亮），信息不冲突
