# GLM Coding Plan 联网 MCP 工具接入（webSearchPrime + webReader）

## 背景

用户持有个人版 GLM Coding Plan，套餐内含专属 MCP 额度但闲置。智谱为 Coding Plan 用户提供两个远程 MCP Server（streamable HTTP + Bearer Key 认证）：

- **联网搜索**：`https://open.bigmodel.cn/api/mcp/web_search_prime/mcp`，工具 `webSearchPrime` —— 全网搜索，返回标题/URL/摘要/站名/图标
- **网页读取**：`https://open.bigmodel.cn/api/mcp/web_reader/mcp`，工具 `webReader` —— 抓取网页，返回标题/正文/元数据/链接列表

接入后与内嵌浏览器工具互补：MCP 是纯 API 直出（快、不占浏览器会话），浏览器工具走渲染（适合复杂页面）。走可选工具包体系（tool-packs.ts → enabledToolPacks → pi-session 挂载），不做通用 MCP 接入层、不接 OAuth、子会话 ability 暂不挂（先主会话）。

## 改动清单

### 1. 新建 `electron/main/services/bigmodel-mcp-service.ts`（MCP HTTP client）

手写轻量 client，不引入 MCP SDK：

- JSON-RPC over streamable HTTP：`initialize` → `notifications/initialized` → `tools/call`
- 请求头：`Content-Type: application/json`、`Accept: application/json, text/event-stream`、`Authorization: Bearer {apiKey}`
- 响应兼容两种格式：纯 JSON 与 SSE（`text/event-stream`，按 `data:` 行拼接取 JSON-RPC 结果）
- initialize 响应头带 `Mcp-Session-Id` 则缓存并在后续请求回传；不带则无状态直呼
- 两个端点各自维护模块级连接状态（lazy init + 单飞防并发重复 init）；`tools/call` 超时 60s（联网搜索/读页可能慢）
- `tools/call` 响应取 `result.content[]`（type=text 拼接），`result.isError` 透传
- 失败重试：会话失效（4xx/JSON-RPC error 含 session 字样）时重置连接并重新 initialize 重试一次

### 2. 新建 `electron/main/agents/tools/web-mcp-tools.ts`（工具组）

两个工具，命名贴合现有 `dogear__browser__readArticle` 三段式风格：

- `bigmodel__webSearch`：入参 `query: string`（必填）、`count?: number`（缺省 10）；返回搜索结果列表
- `bigmodel__webReader`：入参 `url: string`；返回页面标题/正文 markdown/元数据/链接

公共逻辑：

- 执行时 `loadSettings()` 读 `webMcpApiKey`；未配置/为空 → `isError: true` 返回「未配置 GLM Coding Plan API Key，请在设置 → 模型服务填写」（不抛异常）
- 工具 description 注明：走 GLM Coding Plan 专属 MCP 额度；与内嵌浏览器工具的分工（API 直出快档 vs 浏览器渲染档）
- 文件末尾 `registerToolGroup({ server: 'dogear-web-mcp', label: '联网搜索（GLM MCP）', create: createWebMcpToolDefs })`

### 3. `electron/main/services/tool-packs.ts`：注册可选工具包

OPTIONAL_TOOL_PACKS 追加：

```
name: 'web-mcp'
label: '联网搜索'
description: 'GLM 联网搜索与网页读取（webSearchPrime / webReader，API 直出，适合快速检索与简单页面；复杂渲染页面用浏览器工具）'
mcpServerName: 'dogear-web-mcp'
toolCount: 2
requiresWorkspace: false
requirements: '需要 GLM Coding Plan API Key（个人版套餐概览页创建；消耗套餐专属 MCP 额度）'
```

设置页包开关 UI、工具导览注入从注册表自动带上，无需改 AbilityTab。

### 4. `electron/main/agents/pi-session/pi-session.ts`：挂载点

`buildMainAgentToolDefs` 的 `OPTIONAL_TOOL_PACKS` switch 加 `case 'web-mcp'`：`toolDefs.push(...this.registerPack(pack.name, createWebMcpToolDefs()))`。子会话 `buildSubAgentToolDefs` 本期不动。

### 5. `electron/main/services/settings-types.ts` + normalize：API Key 字段

- `AppSettings` 加顶层 `webMcpApiKey?: string`（与 `browserProxyServer` 同级风格，缺省 undefined = 未配置）
- `settings-normalize.ts` 若有字段白名单/裁剪逻辑则补该字段（string 容错），无迁移需求

### 6. `app/settings/page.tsx`：设置页 Key 输入

在「浏览器」配置区后新增「联网搜索（GLM MCP）」区块（复用 `local` + `setLocal` 模式）：

- password 型输入框，占位提示「GLM Coding Plan API Key」
- 说明文案：Key 在个人编程套餐 → 套餐概览页创建；消耗套餐专属 MCP 额度；留空时联网搜索工具包开启也会因缺 Key 报错提示

## 验证

1. `bun run lint` + `bun run build:electron`
2. 设置页填入真实 Key，能力页开「联网搜索」工具包
3. 会话里问「搜一下今天的 AI 新闻」→ agent 调 `bigmodel__webSearch` 返回结果；给 URL 让读 → `bigmodel__webReader` 返回正文
4. 清空 Key → 工具返回 isError 提示而非崩溃
5. 关掉工具包 → 工具不可见

## 不分步骤说明

改动跨 6 文件但为单一原子功能（client + 工具 + 注册 + UI 一体），无阶段依赖、单执行会话一次可完成、非架构变更，故不做 stepN 分阶段实施。
