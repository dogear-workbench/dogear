---
step: 2
title: 连接层——client service + 启动自动连
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
