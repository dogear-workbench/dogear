---
step: 1
title: failover 渲染重连
status: done
---

## 目标

failover 在主进程换 sessionId 重建 session 后，前端自动重连新 session，流式内容无缝续接；模型选择器显示切换后的模型。

## 依赖上下文（接力棒输入）

- 调查报告（共享区 `failover-investigation.md`）§1-§2 已确认根因：
  - failover 流程：`electron/main/agents/model-failover.ts:100-124` — `updateModelSelection`（:96，只写盘不广播）→ `detachByConversationHolder`（:102）→ `attachConversation`（:106，新 sessionId）→ `broadcastFailoverNotice`（:121）→ `sendMessage` 续跑（:124）
  - 前端按 sessionId 过滤流式事件：`components/agent-chat/hooks/useSessionMessages.ts:28`、`useSessionEvents.ts:38`
  - attach effect 依赖 `[conversationId, archived, sessionRestartTrigger, onLiveSnapshot]`：`useAgentSession.ts:177`；`sessionRestartTrigger` 只在用户手动跨 profile 切模型时 bump（`components/agent-chat/hooks/useSendMessage.ts:405`）
  - failoverNotice 前端监听：`stores/conversation-store.ts:866-872`，目前只 pushFailoverNotice
- 重连机制完全复用「用户手动切模型」路径，不新造通道。

## 计划改动

- [x] `stores/conversation-store.ts:866-872`：failoverNotice 监听器里，除 pushFailoverNotice 外同时触发 sessionRestartTrigger 的 bump（先查 `useSendMessage.ts:405` 调用的 store 方法名与签名，复用同一方法；若该方法带切模型副作用则提取/新增一个纯 bump action）
- [x] `electron/main/agents/model-failover.ts`：`updateModelSelection` 调用成功后补发 `conversationListChanged` 广播（发送方式参照 delegation-bridge 中既有调用），让前端会话列表刷新 modelSelection
- [x] 检查 `useAgentSession.ts` attach effect 重跑后的清理路径：确认旧事件订阅（useSessionMessages/useSessionEvents 持有的旧 sessionId）会被正确替换、liveTail 状态重置为 live snapshot 内容

## 验证

- 写一个 store 层测试（参照 stores 现有测试文件模式）：模拟 failoverNotice 事件到达，断言 sessionRestartTrigger 变化（已做，3 用例）
- 手动路径（可选，需要两个 profile 配置 failover 链）：人为触发 quota 错误（或临时把 `isQuotaErrorMessage` 判定放宽为测试错误消息）确认切换后 UI 续接（可选项，未做）
- 基线：lint / 既有测试 / build:renderer / build:electron（全部通过，零新增失败/警告）

## 实施回填

### 实际改动
- 与计划差异：
  - 第 1 项：`triggerSessionRestart`（useSendMessage.ts:405 调用的方法）本身就是纯 bump action（`sessionRestartTrigger + 1`，无切模型副作用），直接在 failoverNotice 监听器里复用，无需新增 action
  - 第 3 项（检查项）结论：无需改代码。useSessionMessages/useSessionEvents 的 effect 依赖 `[sessionId]`，cleanup 时 unsubscribe、新 sessionId set 后重订阅（React effect 机制保证）；liveTail 由 onLiveSnapshot → applySnapshot 处理：snapshot 非空时逐事件 apply 到 core 尾部（续接语义），为空时早退不清空（与手动切模型同款路径）；重连窗口期事件丢失由 attach 返回的 getLiveSnapshot() 重播补偿
  - 额外（计划外加固）：为验证 conversationListChanged 广播，delegation-test-mocks 的 electron mock 提供假窗口（原 getAllWindows 返回空数组使广播循环不执行）+ 捕获数组；model-failover.test.ts 补断言
- 改动文件清单：
  - `stores/conversation-store.ts`（failoverNotice 监听器补 triggerSessionRestart）
  - `electron/main/agents/model-failover.ts`（新增 broadcastConversationListChanged helper，updateModelSelection 成功后调用）
  - `stores/conversation-store.test.ts`（新增，3 个用例：事件到达 bump + 横幅数据、重复递增与会话隔离、纯 bump 不触碰 pendingSend/preAttached）
  - `electron/main/agents/delegation-test-mocks.ts`（electron mock 假窗口 + conversationListChangedCalls 导出）
  - `electron/main/agents/model-failover.test.ts`（切换后广播断言 + 零副作用断言扩展）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `triggerSessionRestart()`：全局纯 bump，`sessionRestartTrigger: number`（conversation-store）；failoverNotice 到达时与手动切模型共用同一 action；所有挂载的 AgentChat（含独立窗口）attach effect 重跑，无关 tab 重 attach 同一 session（release+retain，无销毁）——与既有手动路径同款全局语义
  - `broadcastConversationListChanged(workspaceId: string): Promise<void>`（model-failover.ts 模块级私有）：遍历 BrowserWindow → `getRendererHandlers(win.webContents).conversationListChanged.send({ workspaceId })`；前端监听（conversation-store.ts:861）→ loadConversations() 刷新列表 modelSelection → 模型选择器/autoCompactPercent 取到新 profile
  - delegation-test-mocks 新增导出：`conversationListChangedCalls: string[]`（捕获广播 workspaceId）
  - store 层测试模式：mock.module('@/lib/events'/'@/lib/client') + `globalThis.window = globalThis` 让模块顶层监听注册生效，emitEvent 手动触发
- 下个 step 该从哪里继续：按 plan.md 顺序进入 step2；failover 渲染重连链路（本 step）已闭环，主进程编排/展示类问题（症状 C）与 usage 问题（症状 A）未动
- 待办或已知限制：
  - 重连后旧失败轮的错误 Alert 保留在 transcript（live tail 已 settled），新 session 内容续接其后；错误 Alert/系统通知/横幅的观感问题属后续 step（症状 C）
  - 可选手动验证（两 profile failover 链 + quota 错误触发 UI 续接）未做，建议后续实机回归时补
  - `bun test` 全量合跑有 9 个既有 mock 污染失败（delegation-test-mocks 的 mock.module 全局污染 settings-service/conversation-service/electron，单文件跑即恢复；含 plan 注明的 usage-service toolCallCount 既有失败），改动前后失败文件集合 diff 验证完全一致，与本 step 无关
