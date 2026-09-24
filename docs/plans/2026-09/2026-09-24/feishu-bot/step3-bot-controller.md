---
step: 3
title: Bot 控制器 + 卡片转换 + agent.ts 多 bot 改造
status: pending
---

## 目标

消息路由全链路：斜杠命令 / Agent 转发 / 回复卡片化 / message_id 幂等；agent.ts 的 bot getter 改多注册。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-ws-client.md] 的 client-service 签名（`onMessage(parsed: { messageId, chatId, senderOpenId, text })`、`replyText`、`replyCard`）
- 参照实现：`electron/main/services/wechat/wechat-bot-controller.ts`（命令表 / `conversationRuntimeService.attachConversation(convId, wsId, 'feishu-bot')` / `broadcastBotBinding` / `useConversationByIndex` / `getAutoInitData` 全部同构）
- 关键决策回顾：ReplyCtx = `{ messageId, chatId, senderOpenId }`；命令回执纯文本、Agent 回复卡片；近期 message_id Set 幂等

## 计划改动

- [ ] 新建 `electron/main/services/feishu/feishu-card.ts`：`markdownToCard(text): Array<CardJson>`——markdown 组件卡片（单 markdown element）；表格降级为等宽文本块（`lark_md` code 样式或 pre）；单卡片超长（阈值实测，先定 4000 字符）拆多条；导出的 CardJson 即 `im.message.reply` 的 content
- [ ] 新建 `electron/main/services/feishu/feishu-bot-controller.ts`（同构微信，改名 feishu）：
  - 命令集同微信：`/help /status /ws /ls /use /new /stop /debug`；`handleIncomingMessage` 入口先过 message_id 幂等
  - Agent 转发：`attachConversation(conversationId, workspaceId, 'feishu-bot')`；`handleAgentReply(text)` 走 `markdownToCard` + `replyCard` 拆条发送
  - `broadcastBotBinding`：`feishuBotBindingChanged` renderer 事件（需在 renderer-handlers.ts 注册，含 `feishuBotAutoInit`）
- [ ] 改 `electron/main/tipc/agent.ts:34-36`：`registerBotStateGetter` 单槽 `_botStateGetter` 改为 Set/数组，新增 `unregisterBotStateGetter`；消费点遍历所有 getter（找到消费处同步改）
- [ ] `electron/main/tipc/feishu.ts`：connect 时把 client-service 的 onMessage 接到 `feishuBotController.handleIncomingMessage`（替换 Step 2 的 console.log 占位）；挂 `sessionMessage`/`sessionComplete` 监听（同 `tipc/wechat.ts` 的 `_sessionMessageHandler` 模式：流式 text 按 sessionId 积累、complete 一次性回复、permission_request 走 debug 通知）；注册 `registerBotStateGetter(() => feishuBotController.getState())`；补 `feishu:getBotStatus` / `feishu:botUseConversation` 路由；disconnect 时精确移除监听
- [ ] `renderer-handlers.ts` 补齐事件：`feishuConnectionStatus`（Step 2 已加）/ `feishuBotAutoInit` / `feishuBotBindingChanged`
- [ ] 编译验证：`bun run build:electron` 通过；微信模块回归不受影响（getter 多注册后 wechat 行为不变）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
