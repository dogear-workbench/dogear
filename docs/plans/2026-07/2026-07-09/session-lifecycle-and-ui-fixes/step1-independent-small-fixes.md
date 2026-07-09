---
step: 1
title: 三个独立小修
status: done
---

## 目标

三个互不相干的小改一起做完，跟主线 refactor 无依赖：CreateSession 派子会话后刷新左侧列表 / agent 派出图标从 Bot 改成 Workflow / AskUserQuestionCard 加"停止"按钮。

## 依赖上下文（接力棒输入）

无前置 step。基于探索确认的当前状态：

- **列表刷新**：`electron/main/agents/delegation-bridge.ts` 的 `startChild()` 在 `conversationService.create()` 之后只广播了 `childStatusChanged`，从未 emit `conversationListChanged`。前端 `stores/conversation-store.ts` 已订阅后者会自动 reload，只需补一行。
- **图标现状**：`components/conversation-list/ConversationRow.tsx:112-122` agent 派出用 `Bot`（蓝/灰），`ConversationRow.tsx:149` 微信 bot 绑定也用 `Bot`（绿）——同图标两种语义。分叉用 `GitBranch`（紫）无需改。用户拍板 agent 派出改成 lucide `Workflow`。
- **AskUser 现状**：`components/agent-chat/AskUserQuestionCard.tsx:178-183` 目前只有一个"提交回答"按钮，走 `client.respondAskUserQuestion`。停止路径已存在：`ChatInputArea.tsx:460` 走 `client.interruptQueryBasedSession({sessionId})`，`query-based-session.ts:517-523` 的 signal abort 会自动 deny 挂起的 AskUser 请求。

## 计划改动

### 1.1 CreateSession 补广播

- [ ] 定位 `electron/main/agents/delegation-bridge.ts` 里 `startChild()` 调用 `conversationService.create()` 的位置（约 202 行）
- [ ] 在 `create()` 之后 emit `conversationListChanged`（跟 `stores/conversation-store.ts` 里"新建对话"按钮走的是同一事件通道）
- [ ] 确认 `CreateSessionBatch` 也是复用 `startChild`，如果不是需要一起补

### 1.2 agent 派出图标换 Workflow

- [ ] `components/conversation-list/ConversationRow.tsx:112-122` 把 agent 派出分支的 `Bot` 改成 lucide `Workflow`，import 也换
- [ ] 保留原色（蓝色正常，灰色表示派出者被删）
- [ ] 检查 `components/agent-chat/SubAgentPanel.tsx` 头部的 `Bot`：若语义是"agent 派出的会话面板"就同步改 `Workflow` 保持视觉一致；若是通用 agent 概念（例如子代理面板通称）保留 Bot。**判断标准**：这个面板是否只在 agent 派出的会话里出现？是就改，否就留。
- [ ] `components/agent-chat/LineageBar.tsx` 的 `CornerDownRight` 不动（那是"从上而来"的溯源箭头，语义不冲突）

### 1.3 AskUserQuestion 加停止按钮

- [ ] `components/agent-chat/AskUserQuestionCard.tsx` 底部按钮组加一个 outline 变体的"停止"按钮，位于"提交回答"左侧
- [ ] onClick 走 `client.interruptQueryBasedSession({sessionId})`
- [ ] 按钮 disabled 条件：仅在 `sessionId` 有效时可点；已提交/已 resolved 的场景组件本身会被卸载，不需要额外判断
- [ ] 文案："停止"（跟 ChatInputArea 停止按钮一致）
- [ ] 图标建议 lucide `Square`（跟 ChatInputArea 一致），或按现有设计风格

## 验证

- `bun run lint` 通过
- `bun run build:electron` 通过
- 手测 3 项：
  1. 触发一次 CreateSession（可以让主 agent 派子会话），检查左侧列表当场出现新对话行
  2. 打开一个 agent 派出的会话，列表行图标为 `Workflow`（流程图样式），非 `Bot`
  3. 在 AskUserQuestion 卡片弹出时点"停止"，验证：卡片消失、pendingState → idle、可以重新输入消息

## 实施回填（做完后填）

### 实际改动

**1.1 CreateSession 补广播** — `electron/main/agents/delegation-bridge.ts`
- 新增 `broadcastConversationListChanged(workspaceId)` helper（约 68 行，紧挨 `broadcastDeliveriesAwaitChanged` 之前），沿用 `wechat-bot-controller.ts` 里已有的同名逻辑（遍历 BrowserWindow → getRendererHandlers → conversationListChanged.send）
- 在 `startChild()` 内 `conversationService.create(...)` 之后调用一次（219 行）
- CreateSession / CreateSessionBatch 均复用 startChild，无需分别改

**1.2 agent 派出图标换 Workflow** — `components/conversation-list/ConversationRow.tsx`
- import 加 `Workflow`（`Bot` 保留给微信 bot 绑定分支）
- agent 派出分支 `Bot` → `Workflow`，颜色/条件逻辑不变
- SubAgentPanel.tsx **未改**：其 `Bot` 是"当前会话内 Task 工具子代理"通用概念（任意会话都可能出现），跟 ConversationRow 的"跨会话 agent 派出"语义不同，不满足"只在 agent 派出会话里出现"的判断标准

**1.3 AskUserQuestion 加停止按钮** — `components/agent-chat/AskUserQuestionCard.tsx`
- 底部按钮组从 `mt-4` 改成 `mt-4 flex items-center gap-2`
- 「提交回答」左侧新增 outline 变体「停止」按钮，图标 lucide `Square`
- onClick 走 `client.interruptQueryBasedSession({ sessionId })`
- `disabled={!sessionId}`；sessionId 从已有 prop 拿，无需新增 context

- 与计划差异：无
- 改动文件清单：3 个（delegation-bridge.ts / ConversationRow.tsx / AskUserQuestionCard.tsx）

### 验证
- `bun run lint`：0 errors，83 既存 no-explicit-any warnings（与本次无关）
- `bun run build:electron`：通过

### 给下一步的接力棒
- 关键签名 / 数据结构：本 step 与 Step 2 后续 refactor 无强依赖
- 待办或已知限制：无
