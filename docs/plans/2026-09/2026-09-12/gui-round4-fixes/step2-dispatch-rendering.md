---
step: 2
title: 派遣渲染统一链
status: done
---

## 目标
agent 用 CreateSession/CreateSessionBatch 派出的子会话与任务执行场景渲染统一：子会话侧初始 task 走注入卡 + 小地图注入语义，主会话侧派遣渲染为通讯卡，通讯卡/注入卡的会话名可点跳转。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 已完成通讯卡视觉修正（text-xs、收起条、中性底）
- 关键文件状态：
  - `electron/main/agents/delegation-bridge.ts` startChild（约 :456 起）：末尾 `session.sendMessage(spec.task)` 为裸文本——这是「子会话消息显示为用户发出」的根因
  - `electron/main/agents/delegation-bridge.ts` pushToParentSession（约 :810）：`buildSenderTag(fromSessionId, fromLabel, delivery, tag)` 已有 sender 标签构造 + `sendMessage(text, { injectionTag: tag })` 的 pendingInjected 注入机制，直接复用
  - `electron/main/agents/task-types.ts:9`：InjectionTag 联合类型
  - 前端 `components/agent-chat/utils.ts:125` senderRegex 解析、`injection-tags.ts`、`types.ts` InjectionTag、`minimap-utils.ts:55` injectedPreviewPrefix、`session-tools.ts` SESSION_MESSAGE_TOOL_NAMES
- 关键决策回顾：数据考古证明主会话从未调过 SendMessage，「主会话发送不渲染」实为 CreateSession 的 task 未纳入消息流渲染；dispatch 用 amber 色系与 task-execution 同族（同为「任务下发」语义）；旧会话裸 task 不迁移

## 计划改动
- [x] `electron/main/agents/task-types.ts`：InjectionTag 加 `'dispatch'`
- [x] `delegation-bridge.ts` startChild：`session.sendMessage(spec.task)` 改为发送 `buildSenderTag(parentSessionId, parentTitle, false, 'dispatch') + '\n' + spec.task`，并传 `{ injectionTag: 'dispatch' }`；parentSessionId/parentTitle 取 startChild 已有的 `parent` 变量（parent.sessionId / parent.title）
- [x] 前端 `types.ts` InjectionTag 加 `'dispatch'`；`utils.ts` INJECTION_TAG_SET 加 `'dispatch'`
- [x] `injection-tags.ts` 加 dispatch：bar `bg-amber-500`、card 中性（同全局决策）、badge `bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`、label「派出」
- [x] `minimap-utils.ts` injectedPreviewPrefix：sender tag 解析处为 dispatch 返回前缀（如 `↗ 派出`；现有 delivery/reply 等前缀样式对齐）
- [x] `session-tools.ts`：SESSION_MESSAGE_TOOL_NAMES 加 `dogear__CreateSession`、`dogear__CreateSessionBatch`
- [x] `AgentCommCard.tsx`：扩展支持派遣方向——`toolInput.title`（或 task 截断 30 字）作收起行名，收起行文案「派出 @名 · 任务摘要」+「派出」徽章；展开态正文为 `toolInput.task` 全文（text-xs）；CreateSessionBatch 渲染为一张卡「批量派出 N 个子会话」，展开列出每条 title + task 摘要。组件内按 toolName 分派（新增 `DispatchCard` 或在 AgentCommCard 加 prop，倾向新组件 `SessionDispatchCard` 与 AgentCommCard 并列，共享收起条与样式件）
- [x] `ContentBlockItem.tsx`：tool_use 分发加 CreateSession/CreateSessionBatch → 派遣卡
- [x] 会话名可点跳转：AgentCommCard 的 `@{peerName}` 与 InjectedMessageCard 的来源名包成 button，点击 `openOrFocusConversation`（`components/conversation-list/utils`，同 NotificationCenter 口径；conversationId 由 sessionId/childId 反查本地 store，查不到则不跳转只展示完整 id）；CreateSession 派遣卡在 toolOutput 就绪后同样可点（解析返回文本中的 sessionId）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - SessionDispatchCard 落为独立文件 `components/agent-chat/SessionDispatchCard.tsx`（计划倾向项），内部按 `toolInput.items` 有无分派 SingleDispatchCard / BatchDispatchCard 两个子形态
  - 会话名跳转抽为 AgentCommCard.tsx 导出的 `SessionPeerLink`（组件）+ `jumpToPeerConversation`（口径函数），注入卡与派遣卡共用；反查口径统一为「本地 store → client.getByWorkspaceId 兕底」，跳转 nodeId = `topic:{groupId}:{id}`（同 NotificationCenter）
  - 收起行的 @名 不可点（在 CollapsibleTrigger 内部，嵌套 button 无效），可点跳转只在展开态元信息行；主进程侧 parent.sessionId 为 null 时以空串入 sender 标签，前端解析降级为不跳转只展示会话名
  - Batch 卡逐条也支持跳转（从 toolOutput 逐行 `- <sessionId>（…` 解析，与 items 顺序对应）；isError 的 batch 只展示错误不列清单
- 改动文件清单：
  - `electron/main/agents/task-types.ts`：InjectionTag 联合类型加 'dispatch'，injectedTag 注释同步
  - `electron/main/agents/delegation-bridge.ts`：startChild 发任务改为 `buildSenderTag(parent.sessionId ?? '', parent.title, false, 'dispatch') + '\n' + spec.task` + `{ injectionTag: 'dispatch' }`
  - `components/agent-chat/types.ts` / `utils.ts`（INJECTION_TAG_SET）/ `injection-tags.ts`（dispatch 样式）/ `minimap-utils.ts`（`↗ 派出` 前缀）：dispatch 全链映射
  - `components/agent-chat/session-tools.ts`：SESSION_MESSAGE_TOOL_NAMES 加 CreateSession / CreateSessionBatch（同时排除出 tool_group 合并）
  - `components/agent-chat/AgentCommCard.tsx`：usePeerConversationName → usePeerConversation（返回 Conversation）；新增导出 SessionPeerLink / jumpToPeerConversation；AgentCommCard 展开态 @peerName 可点
  - `components/agent-chat/SessionDispatchCard.tsx`：新增派遣卡组件
  - `components/agent-chat/ContentBlockItem.tsx`：CreateSession / CreateSessionBatch → SessionDispatchCard
  - `components/agent-chat/MessageItem.tsx`：InjectedMessageCard 展开态来源名可点（SessionPeerLink）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SessionPeerLink({ sessionId?: string; displayName: string })`：内部 usePeerConversation 反查，反查不到降级纯文本；只能用在非 CollapsibleTrigger 内（button 嵌套限制）
  - `jumpToPeerConversation(conv)`：openOrFocusConversation + `topic:{groupId}:{id}`，新卡要跳转会话直接复用
  - dispatch 的 sender 标签由主进程 buildSenderTag 构造，前端 senderRegex 解析 tag="dispatch" → InjectedMessageCard（INJECTION_TAG_STYLES.dispatch）+ 小地图 `↗ 派出`，无需额外分支
  - 派遣卡 sessionId 解析正则：单个 `/已创建新会话 ([^\s（「」"\\]+)/`、批量逐行 `/- ([^\s（]+)（/`，与 toolOutput 文本格式耦合——改 delegation-tools 返回文案时需同步
- 下个 step 该从哪里继续：按 plan.md 顺序继续下一 step；旧会话裸 task 消息（无 sender 标签）保持用户气泡渲染已验证（isInjectedUserMessage 不命中即走原气泡，无迁移）
- 待办或已知限制：
  - ToolBlock.tsx:313-330 的 dogear__CreateSession「打开子会话」result action 成为不可达代码（CreateSession 已被拦截渲染为派遣卡，不再进 ToolBlock），未越界清理，后续 step 顺手删
  - title 缺省时收起行 @名 = task 截断 30 字，可能与会话真实标题（系统生成的「子会话: …」）不完全一致，跳转后可见真名
