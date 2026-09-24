---
step: 2
title: 连接层——client service + 启动自动连
status: done
---

## 目标

WSClient 生命周期管理 + 事件解析（p2p/text 过滤）+ 发消息封装（文本/卡片/reply）+ 主进程启动自动连接 + 连接状态广播。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-config-foundation.md] 的 config service 签名（loadConfig 等）与 `types/feishu.ts` 类型
- 当前关键文件状态：`electron/main/tipc/feishu.ts` 已有 config 四路由
- 关键决策回顾：事件只处理 p2p + text；SDK 不可用则 fallback 自实现 WS（见 plan.md 全局决策）

## 计划改动

- [ ] 新建 `electron/main/services/feishu/feishu-client-service.ts`：
  - `connect(appId, appSecret)`：`lark.WSClient` + `EventDispatcher` 注册 `im.message.receive_v1`，回调里解析并回调注入的 `onMessage(parsed)`；解析规则：`chat_type==='p2p'`、`message_type==='text'`、content JSON 取 `text`，产出 `{ messageId, chatId, senderOpenId, text }`，其余静默忽略
  - `disconnect()` / `isRunning()` / `onStateChange`（EventEmitter 或回调注入，状态：connecting/connected/error/disconnected）
  - 发消息封装：`replyText(messageId, text)`（`im.message.reply`，msg_type text）、`replyCard(messageId, cardJson)`（msg_type interactive）——SDK `Client` 实例复用（token 自动管理）
  - WSClient 断线/重连状态透传到 onStateChange（SDK 自动重连，只透传不干预）
- [ ] `electron/main/tipc/feishu.ts` 加 `feishu:connect` / `feishu:disconnect` / `feishu:getConnectionStatus`；connect 成功后把 client-service 的 onMessage 转发给 bot controller（Step 3 前，先 console.log 占位）
- [ ] 主进程启动入口（找 wechat 模块是否有启动挂载点；没有则在 app ready 后）检测 config 存在 → 自动 `connect`
- [ ] 连接状态广播：`renderer-handlers.ts` 加 `feishuConnectionStatus` 事件，状态变化时向所有窗口 send（参照 `wechatConnectionStatus` 的 safeSend 模式）
- [ ] 编译验证：`bun run build:electron` 通过；有真实凭证时手动调 connect 验证（无凭证则留 Step 5）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 状态广播未用 wechat 的单 sender safeSend 模式，改用项目收口工具 `broadcastToWindows`（`services/renderer-broadcast.ts`，全窗口遍历 + isDestroyed 竞态防护），广播收口在 client-service 内部（连接来源有 tipc 调用与启动自动连接两处）
  - `feishu:connect` 会等待首次握手结果（onReady/onError/15s 超时三者取一）才返回，凭证错误主要由前置的 testConnection 拦截；超时后 SDK 后台重试不干预（符合「只透传不干预」决策），状态事件会继续更新
  - WSClient 生命周期用 generation 计数防幽灵回调（disconnect 后旧 client 的 onReady/onError 不再改状态）；SDK Client/WSClient/EventDispatcher 均设 `loggerLevel: warn` 压默认噪音日志
  - 回写 botName 时复用 `feishuConfigService.testConnection`（botName 缺失时才调，已有则只刷 connectedAt）
  - Step 1 说「SDK 不可用则 fallback 自实现 WS」不适用，纯 SDK 实现无 fallback
- 改动文件清单：
  - `types/feishu.ts`：+`FeishuConnectionStatus` / `FeishuIncomingMessage`
  - `electron/main/tipc/renderer-handlers.ts`：+`feishuConnectionStatus` 事件
  - `electron/main/services/feishu/feishu-client-service.ts`（新建）：connect/disconnect/isRunning/getStatus/onStateChange + handleReceive 事件解析（p2p+text 过滤）+ replyText/replyCard + refreshConnectedMeta 回写 + autoConnectFeishu 导出
  - `electron/main/tipc/feishu.ts`：+`feishu:connect` / `feishu:disconnect` / `feishu:getConnectionStatus`
  - `electron/main/main-app.ts`：whenReady 挂 `autoConnectFeishu()`（自动归档任务后并列）
- 验证：`bun run build:electron` 零错误；node + module hook（mock @egoist/tipc/main）加载 dist 产物实测：初始 disconnected、无凭证 autoConnect 静默跳过、未连接 reply 返回结构化错误、假凭证 connect 走 connecting → SDK 打出 invalid appId → 15s 超时返回结构化错误（不抛异常）、disconnect 后状态干净且无幽灵回调（等 1.5s 验证）；onMessage 占位输出正常

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `feishuClientService.connect(appId, appSecret, onMessage): Promise<{ ok, error? }>`——onMessage 签名 `(msg: FeishuIncomingMessage) => void | Promise<void>`，FeishuIncomingMessage = `{ messageId, chatId, senderOpenId, text }`（即 ReplyCtx + text，Step 3 的 botController.handleIncomingMessage 入参直接从这来）
  - `feishuClientService.replyText(messageId, text)` / `replyCard(messageId, card)`：均返回 `{ ok, error? }`；底层 `client.im.message.reply({ data: { content: JSON.stringify(...), msg_type: 'text'|'interactive' }, path: { message_id } })`，返回值是 `{ code, msg, data }`（注意：与 `client.request` 的 axios response 不同，body 不在 `.data` 里）
  - `disconnect(): Promise<void>` / `isRunning(): boolean` / `getStatus(): { state, errorMessage? }` / `onStateChange(cb): () => void`（返回解绑函数）
  - `logIncomingMessage`（导出函数）：Step 3 把它换成 botController 的消息处理即可（tipc/feishu.ts connect 路由与 autoConnectFeishu 内部两处引用）
  - 状态变化已自动全窗口广播 `feishuConnectionStatus { state, errorMessage? }`；前端 Step 4 监听该事件 + `feishu:getConnectionStatus` 拉取（返回含 running/botName/connectedAt）
- 下个 step 该从哪里继续：Step 3 `feishu-bot-controller.ts`——同构 wechat-bot-controller，attachConversation 来源用 `'feishu-bot'`；命令回执用 `replyText`，Agent 回复经 feishu-card.ts 转卡片走 `replyCard`；接线点：把 `logIncomingMessage` 两处引用替换为 controller 处理函数（无需改 client-service）
- 待办或已知限制：
  - 事件解析（p2p+text 过滤）未经真实 WS 事件验证（需真凭证，Step 5 端到端覆盖）；假凭证已验证 SDK 错误路径
  - 假凭证时 SDK 内部重试循环中 onError 不触发（SDK 行为），connect 会等到 15s 超时；真实流程凭证错误被 testConnection 前置拦截，影响有限
  - connect 超时后 wsClient 保留（running: true），SDK 后台继续重试，可能稍后自动变 connected——前端徽标按状态事件驱动展示即可
  - mentions 占位符（@bot）未做剥离，p2p 文本一般不含，Step 3 实测如遇到再处理
