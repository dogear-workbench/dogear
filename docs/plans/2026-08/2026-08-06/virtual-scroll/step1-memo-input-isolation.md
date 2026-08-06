---
step: 1
title: React.memo + 输入框隔离
status: done
---

## 目标

立即解决两个最高频痛点：输入框打字卡顿、流式输出时历史消息全量重渲染。为后续虚拟滚动打好基础（memo 是虚拟滚动的配套——可见范围内的历史轮次也不会因最后一轮的 token 更新而重渲染）。

## 依赖上下文（接力棒输入）

- 前置设计文档：`docs/plans/2026-08/2026-08-06/virtual-scroll-design.md`
- 关键文件状态：
  - `components/agent-chat/MessageItem.tsx` — 当前是普通函数组件，无 memo
  - `components/agent-chat/ChatInputArea.tsx` — 作为 AgentChat 子组件，props 中混了 messages 相关的派生值
  - `components/agent-chat/transformers.ts` — `streamReducer` 已保证：未变化的消息对象引用不变（`updated[lastIdx] = { ...lastMsg, ... }` 只替换最后一条，前面的消息引用不变）

## 计划改动

### 1. MessageItem 加 React.memo

- `components/agent-chat/MessageItem.tsx`
  - 导出改为 `export const MessageItem = React.memo(function MessageItem(...) { ... })`
  - 浅比较即可（`streamReducer` 保证未变消息的引用稳定）
  - 注意 props 中回函数的引用稳定性——`onFork` / `onPermissionResolved` / `onAskUserResolved` / `onInterrupt` 等回调，在 AgentChat 中用 `useCallback` 包裹确保引用稳定（已有的 `handlePermissionResolvedWithScroll` / `handleAskUserResolvedWithScroll` 已经是 useCallback，检查其他传入的回调是否稳定）

### 2. ChatInputArea 隔离

- `components/agent-chat/ChatInputArea.tsx`
  - 加 `React.memo` 包裹组件
  - 检查所有 props：确保不传入每次渲染都变的新对象/数组字面量
  - AgentChat 中传给 ChatInputArea 的 props 审查：
    - `sendMessage.input` / `sendMessage.setInput` — 这些来自 `useSendMessage` hook，检查引用稳定性
    - `settings` — 来自 `useSettingsStore`，引用稳定
    - `currentConversation?.modelSelection` — 切模型时才变，OK
    - `slashCommands` 相关 — 检查 `slashCommands.filteredCommands` 是否每次都是新数组
    - `imageAttachment` 相关 — 检查 `pendingImages` 数组引用稳定性

### 3. 回调引用稳定化

- `components/agent-chat/AgentChat.tsx`
  - 审查所有传给 MessageItem 和 ChatInputArea 的回调，确保都用 useCallback 包裹
  - 重点：`onFork`（`sendMessage.handleFork`）、`onInterrupt`（`sendMessage.handleInterrupt`）、`handleSend`、`handleKeyPress` 等行内箭头函数需要提到 useCallback 或用 useMemoized 形式

## 实施回填（做完后填）

### 实际改动
- 改动文件清单（4 个文件）：
  1. `components/agent-chat/MessageItem.tsx` — export 改为 `memo()` 包裹，默认浅比较
  2. `components/agent-chat/ChatInputArea.tsx` — export 改为 `memo()` 包裹
  3. `components/agent-chat/AgentChat.tsx` — handleSend / handleKeyPress / handleSelectionChange / handleSlashCommandSelect 4 个行内函数提到 useCallback
  4. `components/agent-chat/hooks/useSendMessage.ts` — handleSend / handleKeyPress 改为 useCallback，新增 messagesRef 解耦 messages 数组依赖
- 与计划差异：计划未列 useSendMessage.ts，但 handleSend/handleKeyPress 原是普通函数，流式输出时因 messages 变化产生新引用，导致 AgentChat useCallback deps 失效 → ChatInputArea memo 失效。用 messagesRef 解耦后流式 token 期间 handleSend 引用稳定。

### 给下一步的接力棒
- MessageItem 已 memo 化（默认浅比较），props 全部引用稳定（streamReducer 保证未变消息引用不变，回调全部 useCallback）
- ChatInputArea 已 memo 化，流式输出期间不重渲染；用户打字时仅 input prop 变化触发
- handleSend/handleKeyPress 通过 messagesRef 解耦，流式期间引用稳定；后续如改 useSendMessage 增加新闭包依赖需更新 useCallback deps
- 下个 step 该从哪里继续：`useVirtualTurns` hook 从零开始新建，不依赖 step 1 的产出物，但 step 3 的适配依赖 step 1 的 memo 保证
