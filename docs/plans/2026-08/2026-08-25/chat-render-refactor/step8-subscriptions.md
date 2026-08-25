---
step: 8
title: 订阅收窄与多 tab 修复
status: pending
---

## 目标

收窄 Zustand 订阅边界，消除无关 store 更新对 AgentChat 树的唤醒；修复 minimap / compact boundary 在多 tab 下使用全局 selectedConversation 的错位。

## 依赖上下文（接力棒输入）

- 前置 step：[step7-render-scroll.md] 渲染边界已拆，AgentChat 重渲染触发源已收敛——本 step 处理剩余的 store 订阅噪音。
- 关键现状（已核实）：
  - `useTopicArchiveState.ts`：订阅整个 `groups` 数组并放进异步 resolve effect 依赖（:19 groups、:73 effect deps）；订阅整个 `conversations`（:18）。
  - `MessageMinimap.tsx:31` 与 `ContentBlockItem.tsx` CompactBoundaryDivider（:18-20）：`useConversationStore((s) => s.selectedConversation?.id)` ——多 tab（conversationIdOverride）下拿到的是全局选中会话而非当前 tab 会话，折叠状态读错。
  - `AgentChat.tsx` 顶层订阅：conversations 全表（:75）、settings 对象、childSnapshotsById 按 id 取（已局部化）。
  - `useSendMessage.ts`：订阅 reference-store 七组状态 + selectedConversation?.title。

## 计划改动

- [ ] `useTopicArchiveState.ts`：
  - groups 订阅改为「按 conversation.groupId 精确选」：先从 conversation 拿 groupId，再 `useGroupStore((s) => groupId ? s.groups.find(g => g.id === groupId) : undefined)`（对象引用在 group 不变时稳定）；effect 依赖数组去掉整表 groups。
  - conversations 订阅改 `useConversationStore((s) => s.conversations.find(c => c.id === conversationId))` 或保持 knownConversation 的 useMemo 输入改用窄选择器。
- [ ] conversationId 显式传参修复多 tab 错位：
  - `MessageMinimap` props 加 `conversationId: string | null`，删除内部 selectedConversation 订阅；AgentChat 传当前 tab 的 id（compact-collapse 的 isCollapsed/toggle 已是按 id 调用，只需把读取 id 的来源从全局改 props）。
  - `ContentBlockItem` 的 CompactBoundaryDivider：block 渲染深层拿不到 props——改为从 React Context 提供（AgentChat 处 Provider `ConversationIdContext`），Divider 与 minimap 都从 context 读；或者经 MessageItem → ContentBlockItem 逐层传 props（层级 4 层，Context 更干净）。选 Context。
- [ ] `AgentChat.tsx` 顶层订阅审计：
  - `conversations` 全表订阅仅用于 LineageBar 的 onOpenParent 查父会话——改为事件时 `useConversationStore.getState().conversations.find(...)`（回调内读快照，去掉订阅）。
  - settings 订阅下沉：displayMode（MessageItem 内已自订阅 settings，保持）——AgentChat 顶层的 settings 仅供 ChatInputArea props，ChatInputArea 已大量 props 透传，评估把 settings 订阅下沉到 ChatInputArea 内部（props 删 settings）。若改动面大，保守保留（settings 变化低频，非热点）。
- [ ] `useSendMessage.ts`：`conversationTitle` 订阅仅用于「新对话自动标题」判断——改为 send 回调内 getState() 读快照，去掉 hook 订阅；reference-store 七组订阅是输入区功能必需，保留。
- [ ] 检查 step 4-7 引入的新订阅（useTranscriptState 的 store 方案若有 selector）遵守同样原则：selector 返回标量或稳定引用，不返回新分配对象。

## 验证

- `bun run build:renderer` 通过。
- 多 tab 场景：tab A 折叠历史、tab B 展开，切 tab 折叠状态各自正确（修复前 B 会错读 A 的）；minimap 在非选中 tab 也高亮正确轮次。
- 左侧会话列表操作（重命名、归档其他会话）不再触发 AgentChat 树渲染（Profiler 抽查）。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 订阅变更清单（供 step 9 基准时对照）：
- 待办或已知限制：
