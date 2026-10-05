---
step: 1
title: unread 数据链路
status: pending
---

## 目标

conversation 记录拥有 unread 标记：会话一轮跑完（含子会话交付）时标记，成为全局焦点时清除，状态翻转落盘。

## 依赖上下文（接力棒输入）

- 设计文档：[../tab-bar-rework-design.md](../tab-bar-rework-design.md)「数据流」一节
- `stores/conversation-store.ts` 已有四个运行态 Set 的后端事件订阅（sessionStateChanged / sessionClosed / aliveConversationsChanged / pendingAction 相关），unread 订阅点优先并入既有订阅处，不新开监听
- `services/conversation-service.ts` 管理 `.dogear/conversations.json` CRUD（含 modelSelection/usageSummary 懒重算先例），写后广播 conversationListChanged
- `services/focused-conversation-service.ts` 是全局焦点会话内存态（值变化才广播），前端有对应事件订阅链路
- 关键决策回顾：unread 挂在 conversation 数据层而非 session-store，因为不占 tab 的会话（agent 派的子会话、飞书 bot、定时任务）也要有未读态，左侧列表是它们的主视图

## 计划改动

- [ ] 核实 `electron/main/tipc/agent.ts` 完成事件链（handleSessionNotification 的 complete 分支）：广播负载是否含 conversationId（可能只有 sessionId）；若缺，在广播源头补 conversationId（后端 sessionManager 处应能取到，核实 `agents/query-based-session.ts` 或 pi-session 侧的关联）
- [ ] `stores/conversation-store.ts`：订阅完成事件 → 该会话非当前焦点则置 unread（内存态 + 调 conversation-service 落盘）；订阅 focusedConversationChanged → 焦点会话有 unread 则清除并落盘
- [ ] `services/conversation-service.ts`：conversation 记录支持 `unread?: boolean` 字段的读写（若 CRUD 是整记录更新则零改动，仅类型扩展）
- [ ] 边界：完成瞬间该会话正是全局焦点 → 不标未读直接短路；落盘仅在翻转时发生一次

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
