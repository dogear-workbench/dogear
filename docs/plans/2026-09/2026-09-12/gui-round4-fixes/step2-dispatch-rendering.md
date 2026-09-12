---
step: 2
title: 派遣渲染统一链
status: pending
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
- [ ] `electron/main/agents/task-types.ts`：InjectionTag 加 `'dispatch'`
- [ ] `delegation-bridge.ts` startChild：`session.sendMessage(spec.task)` 改为发送 `buildSenderTag(parentSessionId, parentTitle, false, 'dispatch') + '\n' + spec.task`，并传 `{ injectionTag: 'dispatch' }`；parentSessionId/parentTitle 取 startChild 已有的 `parent` 变量（parent.sessionId / parent.title）
- [ ] 前端 `types.ts` InjectionTag 加 `'dispatch'`；`utils.ts` INJECTION_TAG_SET 加 `'dispatch'`
- [ ] `injection-tags.ts` 加 dispatch：bar `bg-amber-500`、card 中性（同全局决策）、badge `bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`、label「派出」
- [ ] `minimap-utils.ts` injectedPreviewPrefix：sender tag 解析处为 dispatch 返回前缀（如 `↗ 派出`；现有 delivery/reply 等前缀样式对齐）
- [ ] `session-tools.ts`：SESSION_MESSAGE_TOOL_NAMES 加 `dogear__CreateSession`、`dogear__CreateSessionBatch`
- [ ] `AgentCommCard.tsx`：扩展支持派遣方向——`toolInput.title`（或 task 截断 30 字）作收起行名，收起行文案「派出 @名 · 任务摘要」+「派出」徽章；展开态正文为 `toolInput.task` 全文（text-xs）；CreateSessionBatch 渲染为一张卡「批量派出 N 个子会话」，展开列出每条 title + task 摘要。组件内按 toolName 分派（新增 `DispatchCard` 或在 AgentCommCard 加 prop，倾向新组件 `SessionDispatchCard` 与 AgentCommCard 并列，共享收起条与样式件）
- [ ] `ContentBlockItem.tsx`：tool_use 分发加 CreateSession/CreateSessionBatch → 派遣卡
- [ ] 会话名可点跳转：AgentCommCard 的 `@{peerName}` 与 InjectedMessageCard 的来源名包成 button，点击 `openOrFocusConversation`（`components/conversation-list/utils`，同 NotificationCenter 口径；conversationId 由 sessionId/childId 反查本地 store，查不到则不跳转只展示完整 id）；CreateSession 派遣卡在 toolOutput 就绪后同样可点（解析返回文本中的 sessionId）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
