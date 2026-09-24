---
step: 3
title: Bot 控制器 + 卡片转换 + agent.ts 多 bot 改造
status: done
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
  - **agent.ts getter 消费点已不存在**：grep 全仓确认 `_botStateGetter` 只有定义与 wechat.ts 注册，无读取处——4 月重构广播机制时 user 消息 source 注入逻辑已随 setBroadcaster 重写被移除。故多注册改造仅 API 层面（Set + register/unregister），无消费遍历可改；wechat.ts 注册方零改动（Set.add 幂等）
  - **autoConnectFeishu 从 client-service 移到 tipc/feishu.ts**：自动连接需同时接 bot 消息处理与 session 监听，留在 client-service 会形成 service→tipc 循环依赖；移到 tipc 层与微信「轮询启动含监听挂载全在 tipc/wechat.ts」同构。main-app.ts 仅改动态 import 源一行（`./services/feishu/feishu-client-service.js` → `./tipc/feishu.js`）
  - **conversation-runtime-service.ts 加了一行**：`RuntimeHolderType` 扩 `'feishu-bot'`（attachConversation 第三参的类型门槛，计划未列出但必需）
  - **client-service replyCard 参数类型** `Record<string, unknown>` → `object`（FeishuCardJson 接口无索引签名，JSON.stringify 语义不变）
  - feishu:connect 若已在运行则跳过 connect 但仍执行 init / 挂监听 / 推 autoInit（覆盖 disconnect 后重连场景）
- 改动文件清单：
  - `electron/main/services/feishu/feishu-card.ts`（新建）：markdownToCard + 表格降级等宽 + 4000 字符按行拆分（代码块跨卡自动补 fence）
  - `electron/main/services/feishu/feishu-bot-controller.ts`（新建，418 行与微信同构）：命令集/attach('feishu-bot')/broadcastBotBinding/useConversationByIndex/getAutoInitData + message_id 幂等（Set+顺序队列，上限 500）
  - `electron/main/tipc/agent.ts`：getter 多注册（Set + unregisterBotStateGetter）
  - `electron/main/tipc/feishu.ts`：接线（onMessage→controller、sessionMessage/sessionComplete 监听、getBotStatus/botUseConversation 路由、autoConnectFeishu 收编）
  - `electron/main/services/feishu/feishu-client-service.ts`：删 logIncomingMessage 占位与 autoConnectFeishu（移至 tipc 层）
  - `electron/main/tipc/renderer-handlers.ts`：+feishuBotAutoInit / feishuBotBindingChanged
  - `electron/main/services/conversation-runtime-service.ts`：RuntimeHolderType 扩展
  - `electron/main/main-app.ts`：autoConnect 动态 import 源一行
- 验证：`bun run build:electron` 零错误；node + module hook 加载 dist 全链实测——tipc/index 双 router 并存无循环/TDZ，feishu 9 路由含新两条，wechat 12 路由无回归，getter 多注册/去重/反注册 OK，无会话兜底回复不抛错，重复 message_id 幂等拦截生效；markdownToCard 纯函数实测（普通 md/表格降级对齐/超长拆分/代码块跨卡 fence 成对/空输入）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `feishuBotController`：`handleIncomingMessage(FeishuIncomingMessage)` / `getState()` / `getAutoInitData()`（与微信 BotState 结构完全一致）/ `useConversationByIndex(index)` / `handleAgentReply(text)`（卡片化）/ `handlePermissionNotify(toolName, sessionId)` / `init()`
  - tipc：`feishu:getBotStatus` → getAutoInitData 直传；`feishu:botUseConversation input { index }` → `{ success, error? }`；`feishu:connect` 成功后向 sender 推 `feishuBotAutoInit`
  - 渲染层事件：`feishuBotAutoInit` / `feishuBotBindingChanged { conversationId }` / `feishuConnectionStatus { state, errorMessage? }`（Step 2 已有）
  - 自动连接：启动时 `main-app.ts` 动态 import `tipc/feishu.js` 的 `autoConnectFeishu()`——内部 connect→init→挂监听；启动场景不推 autoInit（渲染层未就绪，Step 4 应主动拉 `feishu:getBotStatus`）
- 下个 step 该从哪里继续：Step 4 渲染层——`stores/feishu-store.ts` + `components/feishu/` 三组件 + `app/page.tsx` 入口；状态拉取用 `feishu:getConnectionStatus`（含 running/botName/connectedAt）+ `feishu:getBotStatus`，事件监听上述三个 feishu 事件
- 待办或已知限制：
  - 4000 字符拆分阈值为计划定值，未经真实发送验证（飞书卡片 content 实际上限更大，阈值保守），Step 5 端到端覆盖
  - @bot mentions 占位符未剥离（同 Step 2 已知限制）
  - agent.ts getter 当前无消费点（历史 source 注入已移除），多注册 API 就绪；若后续恢复 bot 消息 source 标记，消费处遍历 `_botStateGetters` 即可
  - 表格降级仅识别 trim 后以 `|` 开头的行块；非标准表格（无尾管道）按普通文本透传
