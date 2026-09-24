---
step: 1
title: 基础层——SDK 安装 + 配置服务 + 配置路由
status: done
---

## 目标

装好官方 SDK，凭证可保存、可两层校验（token 换取 + bot 信息拉取），错误文案精确到开放平台修复位置；tipc 配置路由可用。

## 依赖上下文（接力棒输入）

- 参考 `electron/main/services/wechat/wechat-auth-service.ts` 的 token 持久化模式（`getConfigDir` 区分 packaged/dev，`safeJsonWrite` 落盘）
- 设计文档：`docs/plans/2026-09/2026-09-24/2026-09-24-feishu-bot-design.md`「数据流①」一节

## 计划改动

- [ ] `bun add @larksuiteoapi/node-sdk`；随后立即在主进程代码 import 并 `bun run build:electron` 验证（SDK 兼容性风险前置暴露）
- [ ] 新建 `types/feishu.ts`：`FeishuConfig`（appId/appSecret/botName?/connectedAt?）、`FeishuTestResult`（ok + 失败阶段 + 中文指引）、`FeishuConnectionState`（disconnected/connecting/connected/error）
- [ ] 新建 `electron/main/services/feishu/feishu-config-service.ts`：
  - `loadConfig()` / `saveConfig(cfg)` / `clearConfig()`（`.dogear/feishu/config.json`，路径逻辑同 wechat-auth-service 的 getConfigDir）
  - `testConnection(appId, appSecret)`：两层校验——① SDK `Client` 无凭证调 `auth.tenantAccessToken` 语义（或直接 fetch `https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`）失败→「App ID 或 App Secret 不正确，请在开放平台-凭证与基础信息核对」；② 拉 bot 信息（`bot/v3/info`）失败→「机器人能力未开启或应用未发布，请到开放平台-添加应用能力-机器人 开启并发布版本」
- [ ] 新建 `electron/main/tipc/feishu.ts` 雏形：`feishu:getConfig` / `feishu:saveConfig` / `feishu:clearConfig` / `feishu:testConnection`；注册进主 tipc 入口（找 `wechatRouter` 的注册处并列）
- [ ] 编译验证：`bun run build:electron` 通过；无凭证时 `testConnection` 返回结构化错误（不是抛异常）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 第一层 token 校验用直接 fetch（计划允许），第二层 bot info 用 SDK `Client.request` + `withTenantToken`（复用第一层换来的 token，避免 SDK 隐式再换一次）——SDK 真实被 import 且 HTTP 栈被验证，风险前置达成
  - SDK 实测确认：`Client`/`WSClient` 导出存在；`domain` 默认 `Domain.Feishu`；`client.request` 的 url 不以 http 开头时自动拼 `${domain}/${url}`，需写全 `/open-apis/bot/v3/info`；返回值是 axios response，body 在 `.data`
- 改动文件清单：
  - `package.json` / `bun.lock`：+`@larksuiteoapi/node-sdk@1.74.0`
  - `types/feishu.ts`（新建）：FeishuConfig / FeishuTestResult / FeishuConnectionState
  - `electron/main/services/feishu/feishu-config-service.ts`（新建）：config CRUD + testConnection 两层校验，类型镜像 types/feishu.ts（rootDir 限制）
  - `electron/main/tipc/feishu.ts`（新建）：feishu:getConfig / saveConfig / clearConfig / testConnection 四条路由
  - `electron/main/tipc/index.ts`：注册 feishuRouter（wechatRouter 后并列）
- 验证：`bun run build:electron` 零错误；node 加载 dist 产物 OK；假凭证实测返回 `{ ok: false, stage: 'token', error: 'App ID 或 App Secret 不正确（invalid param），…' }` 结构化错误（非抛异常），飞书真实 API 错误路径已验证

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `feishuConfigService`：`loadConfig(): Promise<FeishuConfig | null>` / `saveConfig(cfg)` / `clearConfig()` / `getCachedConfig(): FeishuConfig | null` / `testConnection(appId, appSecret): Promise<FeishuTestResult>`
  - `FeishuTestResult = { ok, stage?: 'token' | 'bot_info', botName?, error? }`，error 已含开放平台修复指引文案
  - tipc：`feishu:getConfig → { configured, appId?, botName?, connectedAt? }`（不回传 secret）；`feishu:saveConfig input { appId, appSecret, botName? }`；`feishu:testConnection input { appId?, appSecret? }`（缺省回落到已存 config）
  - config 路径：packaged 用 `userData/.dogear/feishu/config.json`，dev 用 `process.cwd()/.dogear/feishu/config.json`（同 wechat）
- 下个 step 该从哪里继续：Step 2 `feishu-client-service.ts`——`new WSClient({ appId, appSecret })`（domain 默认 Feishu，autoReconnect 默认 true），事件订阅 `im.message.receive_v1`；connect/disconnect 生命周期 + FeishuConnectionState 状态广播（tipc feishu.ts 加 connect/disconnect/getConnectionStatus 路由）；启动自动连接读 loadConfig()
- 待办或已知限制：
  - testConnection 成功后 botName/connectedAt 未回写 config（留给 Step 2 connect 成功时更新，保持本 step 最小边界）
  - bot_info 层未经真实凭证运行验证（仅编译 + import + 假凭证 token 层验证），有真凭证时走一遍 SetupGuide 即可确认
  - 主进程 electron/ 目录在 eslint ignore 里（项目现状），靠 tsc strict 把关
