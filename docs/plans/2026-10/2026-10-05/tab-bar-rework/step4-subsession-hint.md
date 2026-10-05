---
step: 4
title: 子会话已交付提示条
status: done
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
  1. **信号源选定 bridge 内存快照 childSnapshotsById**（childId 即子会话 conversationId，delivered 由 markChildDelivered 单调置位）；排除 runningSet 移除（无法区分从未运行）与 sessionClosed（主子都收到、无交付语义）。判定 = 快照存在 ∧ delivered ∧ status≠running ∧ !runningConversationIds（覆盖交付后收尾/复活/追问三个 running 窗口）
  2. **主会话链路核实**：parentConversationId 对 role='sub' 就是父会话 conversationId（startChild 写入、listByParent 依赖），同名双语义以 role 区分，可直接用；contractMetadata.parentSessionId 仅老数据兑底（按 sessionId 反查）。跳转：本地命中 → openOrFocusConversation（topic 深链参数）/ openPersonalConversation（personal）；本地未命中 → focusConversationFromLink 跨工作区深链；均失败 toast。step 文档提到的 onOpenParent 在现代码已不存在（LineageBar 历史产物），用上述既有机制等效达成
  3. **收紧显示口径**：「已交付且停跑」才显示；stopped 未交付（失败/超时/取消）不显示（文案对失败终态是错误引导）；未做弱化版（进程重启后 delivered 不可从磁盘恢复，显示即是错误信息，宁缺勿滥）
  4. 派生态放局部 hook 而非 store（纯派生判定不值得进 store）
  5. 独立窗口隐藏「回主会话」按钮（无跨窗口跳转基建，文案保留）
- 改动文件清单：
  - `components/agent-chat/hooks/useSubSessionDelivered.ts`（新建）— 三条件判定 hook
  - `components/agent-chat/SubSessionDeliveredBanner.tsx`（新建）— emerald 提示条 + 回主会话三级跳转 + dismissed useState（每 tab 持久实例天然记住关闭）
  - `components/agent-chat/AgentChat.tsx` — 输入区分支内 ChatInputArea 前渲染 banner（+4 行）

### 给下一步的接力棒
- 关键签名 / 数据结构：`useSubSessionDelivered(conversationId): boolean`；banner 组件接 Conversation 对象；未拦截发送（ChatInputArea 零改动）
- 下个 step 该从哪里继续：Step 5（溢出收纳）依赖的 displayTabs 聚组序已在 Step 3 就绪，注意「…」菜单序与 tab 序统一
- 待办或已知限制：
  - 独立窗口跨窗口跳转需主进程基建，后续需要时单独立项
  - 冷启动落在子会话 tab 时 refreshAllChildren 异步填充前提示条短暂不出现（渐进增强）
  - bun test 4 fail 全为 terminal ConPTY 既有超时，与本次无关
