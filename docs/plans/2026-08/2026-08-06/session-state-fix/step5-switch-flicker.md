---
step: 5
title: O1 切换对话闪烁
status: done
---

## 目标

切换对话时保留旧消息列表直到新消息就绪，消除"先清空再填充"的视觉闪烁。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step4-eager-attach.md] B3 可能改变 useMessageHistory 的使用方式（session 已在内存，历史可从 liveSnapshot 获取而非 IPC 重读）
- 关键文件：
  - `components/agent-chat/hooks/useMessageHistory.ts` — effect L21 `setHistoryLoaded(false)` → L28 异步 `getConversationHistory` → L46 `setMessages(result.messages)`
- 当前闪烁原因：effect 在 conversationId 变化时立即 `setMessages([])`（隐含在 setHistoryLoaded(false) + 空数组初始值），异步加载后才填回
- 需确认：B3 改动后 useMessageHistory 是否还独立走 IPC 加载，还是从 session liveSnapshot 取（如果后者，闪烁可能已消失）

## 计划改动

- [ ] `useMessageHistory.ts`：effect 开头移除 `setMessages([])`，保留上一次对话的消息直到新结果 `setMessages(result.messages)` 一次性替换
- [ ] 确认 `historyStatus === 'loading'` 期间的 UI 表现不显示空状态/骨架屏（historyLoaded=false 控制 useAgentSession，不影响消息列表渲染）
- [ ] 确认快速切换的 `cancelled` 路径：旧 effect 被 cancel 不执行 setMessages，消息停留在上一次状态，下一个 effect 接上
- [ ] 验证：切换对话无空白闪烁

## 实施回填（做完后填）

### 实际改动
- 与计划差异：计划第 1 项「移除 effect 开头 setMessages([])」在现状代码已不存在（effect 开头无此调用，仅 conversationId 为 null 分支有），无需改动；第 3 项 cancelled 路径由现有守卫覆盖。真实闪烁路径为首次挂载已有历史对话时空态闪现（messages 初始 []，topicState loading→active 后、attach snapshot / getConversationHistory 返回前，空态条件成立约一帧），改动集中在渲染层空态守卫
- 改动文件清单：`components/agent-chat/AgentChat.tsx`（解构新增 historyStatus + 空态条件加 historyStatus !== 'loading' 守卫，1 文件 2 处）

### 给下一步的接力棒
- 关键签名 / 数据结构：`useMessageHistory({ conversationId })` 返回的 `historyStatus: 'loading' | 'ok' | 'empty' | 'error'` 新增被渲染层消费；空态条件（AgentChat.tsx）：`messages.length === 0 && historyStatus !== 'loading' && !isReadOnly && !isTopicStatePending`
- 下个 step 该从哪里继续：本 step 是 session-state-fix 计划最后一个 step，无后续
- 待办或已知限制：historyStatus/historyLoaded 未来如需「加载中」UI（如骨架屏）可直接消费现有返回值；本次未动主进程/electron 代码
