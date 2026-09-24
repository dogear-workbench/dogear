# 飞书 Bot 接入实施计划

**目标**：飞书私聊遥控 Dogear——同微信 Bot 的斜杠命令 + Agent 转发，回复以 markdown 卡片回到飞书。

**架构思路**：平行建 `feishu` 模块（不抽象通用渠道层，微信 iLink 与飞书 API 形态差异大，YAGNI）；协议层用官方 `@larksuiteoapi/node-sdk`（WSClient 自带心跳/重连/去重）；Bot 控制器同构复制微信实现。详见 [设计文档](../2026-09-24-feishu-bot-design.md)。

**涉及模块**：`electron/main/services/feishu/`（4 新文件）、`electron/main/tipc/feishu.ts`、`electron/main/tipc/agent.ts`（单槽 getter 改多注册）、`stores/feishu-store.ts`、`components/feishu/`（3 组件）、`types/feishu.ts`、`app/page.tsx`（入口按钮）

## 步骤索引

- [x] [Step 1: 基础层——SDK 安装 + 配置服务 + 配置路由](./step1-config-foundation.md) — 凭证可存可校验，错误精确到修复指引
- [ ] [Step 2: 连接层——client service + 启动自动连](./step2-ws-client.md) — WSClient 生命周期 + 事件解析 + 发消息封装
- [ ] [Step 3: Bot 控制器 + 卡片转换 + agent.ts 多 bot 改造](./step3-bot-controller.md) — 消息路由全链路（命令/转发/回复/幂等）
- [ ] [Step 4: 渲染层——store + 引导 UI + 控制台 + 入口](./step4-renderer-ui.md) — 配置引导（外部浏览器 + 步骤文案）+ 连接状态 + Bot 控制台
- [ ] [Step 5: 端到端联调（用户参与）](./step5-e2e.md) — 真实凭证走通全链路 + 文档收尾

## 全局决策

- **命名**：全部 `feishu` 前缀；tipc 路由 `feishu:xxx`；attachment 来源 `'feishu-bot'`（对应微信 `'wechat-bot'`）
- **ReplyCtx**：`{ messageId: string; chatId: string; senderOpenId: string }`（飞书无微信式 contextToken，回复统一走 `im.message.reply`）
- **凭证存储**：`.dogear/feishu/config.json` 明文（`{ appId, appSecret, botName?, connectedAt? }`，与微信 token 同级别）
- **消息过滤**：只处理 `chat_type === 'p2p'` 且 `message_type === 'text'`，其余静默忽略
- **回复形态**：Agent 回复走卡片（feishu-card.ts 转换）；命令回执走纯文本（`msg_type: 'text'`，简单信息不需要卡片）
- **幂等**：controller 维护近期 `message_id` Set（上限清老），防事件重复推送
- **SDK 风险**：若 `@larksuiteoapi/node-sdk` 在 Bun/Electron 主进程不可用，fallback 为自实现 WS（`wss://open.feishu.cn/open-apis/event/v2/connect`，处理 ping/pong 与重连）——Step 1 安装后立即验证 import + 编译，风险前置
- **代码风格**：不写注释（项目规则）；错误返回 `{ error }` 不抛异常（tipc 惯例）；单文件 >300 行考虑拆分
- **微信代码零改动**（除 agent.ts 的 getter 多注册，语义不变）

## 用户参与点

- Step 5：开放平台创建应用/登录（用户本人）；日常使用无需参与
