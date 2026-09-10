---
step: 1
title: 终态通知增加注入出口
status: done
---

## 目标

`notifyTerminalToWaiters` 在无挂起 waiter 时不再静默丢弃终态信息，改为向主会话注入消息——为 Step 2 的纯注入出口铺路，本身也是行为增强（现状无 waiter 时终态通知丢失）。

## 依赖上下文（接力棒输入）

- 设计文档：[../event-driven-wait-design.md](../event-driven-wait-design.md)（成本账与边界情况）
- `deliverMessage`（delegation-bridge.ts:810-829）已有双出口范式：waiter 命中 → resolve；否则取 `getPiSessionManager().getSession(...)` 后 `session.sendMessage(buildSenderTag + message)`，返回 `'queued'` / `'target_inactive'`
- `notifyTerminalToWaiters`（delegation-bridge.ts:371-400）现状只 resolve waiter，无 waiter 时无动作
- `buildTerminalNotice`（delegation-terminal.ts:98-111）生成终态文案，含 no_delivery 自愈指引，直接复用
- 关键决策：本步不删任何现有路径，waiter 命中时行为与现状完全一致（回归零风险）

## 计划改动

- [ ] `notifyTerminalToWaiters`：waiter 循环后（或无命中时）追加注入分支，复用 deliverMessage 的 session 获取与 sendMessage 推送逻辑，文案 = buildTerminalNotice 产物；注入失败仅 logger.warn，不抛出
- [ ] 若注入分支与 deliverMessage 的 queued 分支逻辑重复度高，抽一个共用私有函数（如 `pushToParentSession`），deliverMessage 同步改用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。两条计划项均落地，且抽取条件成立——新增共用私有函数 `pushToParentSession(toConversationId, msg): boolean`（delegation-bridge.ts:834），deliverMessage 的 queued 分支同步改用它（waiter 循环原样保留，返回值语义不变）
- `notifyTerminalToWaiters`（delegation-bridge.ts:374）：`buildTerminalNotice` 提前计算一次两分支共用；waiter 命中原样 resolve 并提前 return（回归零风险）；无 waiter 时 `pushToParentSession` 注入（fromSessionId=c.sessionId, fromLabel=c.title, delivery=false），失败仅 logger.warn
- 改动文件清单：`electron/main/agents/delegation-bridge.ts`（+42/-20）

### 给下一步的接力棒
- 关键签名 / 数据结构：`pushToParentSession(toConversationId: string, msg: Omit<DeliverMessageOptions, 'toConversationId'>): boolean`（false ≡ deliverMessage 的 'target_inactive'）；sendMessage fire-and-forget 失败仅 warn
- 下个 step 该从哪里继续：`notifyTerminalToWaiters` 函数名已与行为不匹配（不再只 waiter），Step 2 收口单一注入出口时改名（如 `notifyTerminalToParent`）并删 waiter 分支；waiter 机制（messageWaiters/waitForMessage/abortMessageWaits/collectTerminalWaiterKeys）本步未动，Step 2 整体退役
- 待办或已知限制：测试 mock（delegation-test-mocks.ts）`getSessionIdByConversation: () => undefined`，测试环境注入始终走 target_inactive 降级；Step 2 若要测注入路径需调 mock 返回父会话映射
