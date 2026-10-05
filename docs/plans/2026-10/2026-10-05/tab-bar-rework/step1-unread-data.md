---
step: 1
title: unread 数据链路
status: done
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
  - 核实结论：complete 广播原负载只有 sessionId，已在广播源头用既有 `getPiSessionManager().getConversationIdBySession(sessionId)`（pi-session-manager.ts:292）补 conversationId，无需新实现
  - 焦点判定用 `client.getFocusedConversation()` RPC 拉主进程权威态而非前端镜像（刷新后本地镜像丢失会误标正在看的会话）；RPC 失败保守不标
  - `queryBasedSessionComplete` 此前只有组件级订阅，本次在 conversation-store 既有 rendererEvents 订阅块内新增 listen（未在其他组件开监听）
  - 额外冷启动兜底：启动拉焦点，焦点会话磁盘残留 unread 则清除，维护「焦点会话必无未读」不变量
  - `setUnread` 不做 requireActiveGroup、不更新 updatedAt（归档话题可标记、未读不参与排序）
- 改动文件清单：
  - `electron/main/tipc/agent.ts` — complete 广播补 conversationId
  - `electron/main/tipc/renderer-handlers.ts` — queryBasedSessionComplete 负载加 conversationId?: string
  - `electron/main/services/conversation-service.ts` — ConversationIndex.unread?: boolean + setUnread()（事务内防翻转，值相同不写盘不广播）
  - `electron/main/tipc/conversations.ts` — setUnread RPC procedure
  - `types/electron-api.ts` — 前端 Conversation 镜像加 unread?: boolean
  - `stores/conversation-store.ts` — queryBasedSessionComplete / focusedConversationChanged 订阅 + markUnreadFromComplete / clearUnread actions + patchConversationUnread 全分片内存补丁 + 冷启动兑底

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `conversationService.setUnread(conversationId: string, unread: boolean): Promise<void>`；tipc `client.setUnread({ conversationId, unread })`
  - conversation 记录 `unread?: boolean`（缺省 falsy 兼容旧数据）已在前端全部分片可用（byWorkspace / personal / selectedConversation）
  - `SessionTab.lastActiveAt: number` 未动（属 Step 2），更新点建议与 clearUnread 并列挂 conversation-store 底部 rendererEvents 订阅块的 focusedConversationChanged 处
- 下个 step 该从哪里继续：Step 2 改 session-store（lastActiveAt 字段 + 焦点驱动重排 + openTab 满员回收）；unread 数据源已就绪
- 待办或已知限制：
  - executor / cancelled 的 complete 也标未读（广播无过滤，后台停止标未读合理）；要过滤 result.subtype 在 store 订阅处加
  - `app/data-center/sync-user-paths.tsx:20` 既有 tsc 错误，HEAD 上已存在，与本 step 无关
