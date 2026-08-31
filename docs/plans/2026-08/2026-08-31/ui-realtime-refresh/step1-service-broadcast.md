---
step: 1
title: 会话/组 service 层统一广播
status: pending
---

## 目标

主进程所有会话/组写入点完成后统一广播 `conversationListChanged`（结构操作立即、元数据变化 500ms 去抖），后台建会话/改标题/touchGroup 后前端列表自动刷新。**只加广播，不动前端**（前端已有订阅 conversation-store.ts:865 → loadConversations）。

## 依赖上下文（接力棒输入）

- 设计决策：见 [../ui-realtime-refresh-design.md](../ui-realtime-refresh-design.md) 决策 1
- 现有事件：`conversationListChanged` 已存在，当前仅 3 个发送点（delegation-bridge.ts:111、model-failover.ts:70、wechat-bot-controller.ts:374），渲染层订阅已闭环（conversation-store.ts:865、data-center/usage-panel.tsx:98/129）——本步是把发送点扩展到 service 层全部写方法
- 现有负载情况执行时确认：若当前广播无 payload，本步统一加 `{ workspaceId }` 负载；前端订阅处暂不按它过滤（Step 2 做），无 payload 时多拉一次幂等无害
- conversation-service.create 连带调 touchGroup（conversation-service.ts:357-358），touch 也会（:503-504）——immediate + debounced 混跑时去抖计时器与立即发送并存，helper 需处理「立即发送后取消 pending 去抖」避免双发

## 计划改动

- [ ] 新建 `electron/main/services/conversation-broadcast.ts`：导出 `broadcastConversationListChanged(workspaceId: string, immediate: boolean)`——immediate=true 立即遍历窗口发送并取消 pending timer；false 起/续 500ms 尾部去抖 timer（同 workspaceId 合并）。模块级单 timer 即可（同一时刻列表变化合一次广播，跨工作区也无妨——负载带 workspaceId，前端过滤）
- [ ] `electron/main/services/conversation-service.ts` 写方法接线：
  - immediate：create、createFork、删除、update 类结构字段变更（执行时逐方法过，见「未决」）
  - debounced：touch、updateSessionId、updateModelSelection、autoUpdateTitleFromFirstMessage、applyUsageSummary
- [ ] `electron/main/services/group-service.ts` 写方法接线：
  - immediate：createGroup、updateGroup、deleteGroup、archiveGroup、restoreGroup
  - debounced：touchGroup
- [ ] 既有 3 个发送点（delegation-bridge/model-failover/wechat-bot-controller）改调新 helper（去重，统一出口）
- [ ] `bun run build:electron` 编译通过 + `bun run lint`

## 验证

- 主窗口开一个工作区，另开 debug 窗口（或让主会话派子会话）触发后台 `conversation-service.create`：列表无需操作自动出现新会话
- 会话首条消息触发 autoUpdateTitleFromFirstMessage（tipc/agent.ts:203）：约 0.5s 后左栏/Tab 标题更新
- 任务队列跑一个 backlog 任务：执行会话自动出现在列表

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- broadcastConversationListChanged 的最终签名与负载结构：
- 各写方法实际接线分档清单（与计划的出入）：
- 下个 step 该从哪里继续：
- 待办或已知限制：
