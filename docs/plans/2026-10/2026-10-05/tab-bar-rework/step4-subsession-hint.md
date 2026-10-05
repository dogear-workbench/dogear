---
step: 4
title: 子会话已交付提示条
status: pending
---

## 目标

子会话已交付/停止后，其输入区顶部显示软提示条「任务已交付，新任务建议回主会话 [回主会话]」；运行中不显示；不拦截发送。

## 依赖上下文（接力棒输入）

- 设计依据：[../tab-bar-rework-design.md](../tab-bar-rework-design.md)「主子边界」一节——用户在子会话追问运行细节是合法操作，提示条必须可忽略、无弹窗、不拦截
- `components/agent-chat/AgentChat.tsx` 有 `onOpenParent`（跨会话注入消息卡/父会话跳转链路，历史计划 step4-lineage-tab-behavior 提到 `selectConversation(parent)` 走 openOrFocusConversation 既有机制），回主会话按钮复用它
- 判定「子会话」：conversation.parentConversationId 非空；判定「已交付/停止」：候选来源 = runningConversationIds 移除后、sessionClosed 事件、子会话交付（delivery）事件——执行时核实后端实际广播，选最可靠的（倾向 runningSet 不含 && 曾运行过 或 sessionClosed）；注意子会话从未运行（刚打开看历史）不算「已交付」，此时不显示提示（无任务语义）或显示弱化版，执行时拿真实交互定夺并回填
- 输入区组件：`components/agent-chat/ChatInputArea.tsx`（引用芯片、shunt 气泡等横幅类 UI 已有先例，样式对齐）

## 计划改动

- [ ] 核实子会话终态信号源，在 conversation-store 或局部 hook 暴露派生态（如 `subSessionDelivered(convId)`）
- [ ] `ChatInputArea.tsx`（或其上层 AgentChat 传入）：当前会话为子会话且已交付 → 顶部提示条 + 「回主会话」按钮（跳 parentConversationId 对应会话，复用 onOpenParent / openOrFocusConversation）
- [ ] 提示条样式与现有引用芯片/shunt 气泡横幅一致；可关闭（本次会话视图内记住关闭）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
