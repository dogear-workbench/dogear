# 飞书 Bot 接入设计

**日期**：2026-09-24
**状态**：已与用户对齐

## 背景

Dogear 已支持微信 Bot 遥控（iLink 扫码 → 长轮询收消息 → 斜杠命令/转发 Agent → 回复发回微信）。用户希望以同等能力接入飞书：在飞书私聊里遥控 Dogear（切工作区/对话、发消息给 Agent）。

飞书没有「扫码变 Bot」的个人轻量通道，正路是**开放平台自建应用 + WebSocket 长连接**（社区/OpenClaw 生态已验证生产可用）。差异与取舍：

| 维度 | 微信（现状） | 飞书（本设计） |
|---|---|---|
| 认证 | 扫码即用，token 24h 过期 | 用户在开放平台创建自建应用（一次性 ~10 分钟），app_id/secret 长期有效 |
| 收消息 | iLink 长轮询 | 官方 SDK WSClient 长连接（无需公网） |
| 回复 | 纯文本（markdown 降级） | 交互卡片（markdown 渲染，表格降级文本） |
| 场景 | 私聊遥控器 | 私聊遥控器（群聊 @bot 留作扩展，v1 忽略群消息） |
| Dogear UI | Dialog（认证+联系人+消息面板） | 简化：连接管理 + 配置引导 + Bot 控制台，不做消息面板 |

## 目标

1. 用户在飞书（个人版账号）私聊 Dogear Bot，用与微信同款斜杠命令遥控：`/help /status /ws /ls /use /new /stop /debug`
2. 普通文本直接转发给绑定的 Agent 会话，最终回复以卡片形式回到飞书私聊
3. 首次配置体验：Dogear 内步骤文档 + 外部浏览器打开开放平台 + 粘贴凭证 + 一键测试连接
4. 配好后启动 Dogear 自动重连，用户无需再管

## 架构

**平行建 `feishu` 模块，不抽象通用 Bot 渠道层**。微信 iLink 与飞书 API 形态差异大（长轮询 vs WS、24h token vs 长期 secret、纯文本 vs 卡片），抽象收益要等第三个渠道才兑现（YAGNI）。Bot 控制器同构复制微信实现，行为独立互不干扰。

**协议层用官方 SDK `@larksuiteoapi/node-sdk`**：`WSClient` 自带心跳、断线重连、事件去重；`Client` 封装 REST（发消息/token 管理）。Bun 安装，Electron 主进程运行。

**对既有代码的改动仅一处**：`electron/main/tipc/agent.ts` 的 `registerBotStateGetter` 从单槽改为多注册（列表遍历），语义不变，为的是微信/飞书两个 bot 的来源标记都能工作。

## 模块边界

```
electron/main/services/feishu/
  feishu-config-service.ts    # 配置读写（.dogear/feishu/config.json）+ testConnection 两层校验
  feishu-client-service.ts    # SDK 封装：connect/disconnect 生命周期、事件解析（只处理 p2p）、发文本/卡片/reply
  feishu-bot-controller.ts    # 斜杠命令 + attachConversation('feishu-bot') + Agent 回复（同构 wechat-bot-controller）
  feishu-card.ts              # markdown → 飞书卡片 JSON（表格降级文本、超长拆多条）
electron/main/tipc/feishu.ts  # tipc 路由（config/test/connect/disconnect/botStatus/useConversation）
stores/feishu-store.ts        # 前端状态（连接状态/配置存在性/bot 绑定）
components/feishu/
  FeishuDialog.tsx            # 容器：未配置显示 SetupGuide，已配置显示 ControlPanel
  FeishuSetupGuide.tsx        # 步骤文档（写死）+ shell.openExternal 打开开放平台 + 粘贴框 + 测试连接
  FeishuControlPanel.tsx      # 连接状态徽标 + Bot 控制台（当前绑定对话，同微信 BotControlPanel 精简版）
types/feishu.ts               # 类型（主进程与渲染层镜像，同 wechat 模式）
```

UI 入口：`app/page.tsx` 工具栏微信按钮旁并列加飞书按钮（Dialog 模式同 `WechatDialog`）。

## 数据流

**① 配置引导（一次性）**

SetupGuide 步骤文档引导用户在外部浏览器完成：创建企业自建应用 → 添加机器人能力 → 权限管理（收发消息相关权限，实施时核对精确权限名）→ 事件与回调选「长连接」并订阅 `im.message.receive_v1` → 创建版本并发布（可用范围含自己）→ 复制凭证。回到 Dogear 粘贴 → `feishu:saveConfig` → `feishu:testConnection`：

- 第一层：凭证换 `tenant_access_token`（失败 = app_id/secret 错）
- 第二层：拉 bot 信息（失败 = 机器人能力未开/应用未发布）

错误文案精确到「去开放平台哪个页面修什么」。通过后 `feishu:connect` → WSClient 常驻。

**② 启动自动连接**：主进程启动时发现 `.dogear/feishu/config.json` 存在即自动 connect。

**③ 收消息**：WS 事件 `im.message.receive_v1` → client-service 解析：`chat_type !== 'p2p'` 忽略；`message_type !== 'text'` 忽略；提取文本 + `message_id` + `sender_open_id` 为回复上下文（ReplyCtx）→ botController。

**④ 命令/转发**：`/` 前缀走命令表（同微信命令集）；普通文本经 `conversationRuntimeService.attachConversation(convId, wsId, 'feishu-bot')` 绑定 session 后 `session.sendMessage`。已绑定则直接复用；Agent 处理中收到新消息回复「正在处理」。

**⑤ Agent 回复**：`tipc/feishu.ts` 挂 `sessionManager` 的 `sessionMessage`/`sessionComplete`（与微信同模式）：流式文本按 sessionId 积累，complete 时一次性经 `feishu-card.ts` 转卡片，用 `im.message.reply`（引用来信，上下文挂靠）发回；超长拆多条。

## 错误处理

| 场景 | 处理 |
|---|---|
| secret 错 / 权限缺失 / 未发布 | testConnection 分层报错 + 指引修复位置 |
| WS 断线 | SDK 自动重连；连接状态广播渲染层徽标（连接中/已连/错误） |
| 事件重复推送 | SDK 按 event_id 去重 + controller 按 message_id 幂等兜底（近期 id 集合） |
| 图片/语音等非文本 | v1 忽略不回 |
| 微信/飞书 bot 同时绑同一对话 | 各自独立判断 activeSessionId，互不干扰 |
| app_secret 安全 | 本地 JSON 明文存储（与微信 token 同级别，接受） |

## 未决问题（实施时定）

1. **精确权限名**：开放平台权限标识以实施时开放平台实际命名为准（引导页文案随之写死）
2. **卡片 markdown 限制**：飞书卡片 markdown 组件不支持表格 → 降级为等宽文本块；具体长度上限（超长拆分阈值）实施时实测
3. **SDK 兼容性验证**：`@larksuiteoapi/node-sdk` 在 Bun + Electron 主进程的运行验证（第一步先做 spike：安装 + 最小 WS 连接 demo 跑通）
4. **图片消息**：飞书事件带图片 URL，后续可让 Agent 看图，v1 不做

## 参考

- 微信同构实现：`electron/main/services/wechat/`、`electron/main/tipc/wechat.ts`、`components/wechat/`
- 微信设计文档：`docs/plans/2026-04/2026-04-03/2026-04-03-wechat-bot-agent-integration.md`
- OpenClaw 飞书接入（社区验证）：docs.openclaw.ai/channels/feishu
