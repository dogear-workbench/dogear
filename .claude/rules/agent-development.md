---
paths:
  - "electron/main/agents/**/*.ts"
  - "electron/main/services/stock/python-bridge.ts"
  - "python/**/*.py"
---

# Agent 开发规则

## 通用原则

- 修改 Agent 功能前，先查 `@anthropic-ai/claude-agent-sdk` 包中是否已有实现
  - `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — 接口定义
  - `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` — 工具类型
- QueryBasedSession（`query-based-session.ts`）是当前主要的会话方式，优先在此基础上扩展
- Agent 与渲染层通信通过 `electron/main/tipc/renderer-handlers.ts` 中定义的事件，不要自建 channel

## 目录约定

- `electron/main/agents/tools/` — 自定义 Agent 工具（in-process MCP server，通过 `createSdkMcpServer` 注册）
- `electron/main/agents/skills/` — Agent SDK 内部使用的代码级 skill（如 `chat-skill.ts` 的 ChatSession）
- `.claude/skills/` — Claude Code 标准 skill（SKILL.md + 资源），用于流程编排和工具元指南
- 不要混淆这两类 skills：前者是 SDK 封装层，后者是给 Claude 看的 markdown 指令

## 工具开发

- 每个工具文件末尾必须调用 `registerTools()` 注册元数据（name/description/server/category），供设置页动态加载
- 工具命名遵循 SDK 约定：`mcp__{server_name}__{tool_name}`，server_name 在 `createSdkMcpServer` 时指定
- 输入参数用 Zod schema 严格校验
- 错误情况返回 `isError: true`，不要抛异常（会终止 Agent 循环）
- 单个工具文件超过 5 个工具或 300 行时，按功能域拆分（参考 `stock-tools.ts` / `stock-analysis-tools.ts` 的拆分）

## Python 计算层（股票分析）

- Python 守护进程通过 `electron/main/services/stock/python-bridge.ts` 通信（JSON-RPC，stdin/stdout）
- 修改 `python/core/*.py` 的接口时，同步更新 python-bridge 的 method 列表和 stock-analysis-tools 的工具描述
- Python 端不引入 stdout 输出（会污染 JSON-RPC 协议），用 stderr 或日志文件
- 不可用时降级：python-bridge 启动失败时，基础股票工具（dogear-stock）仍能正常工作

## 模块化范例（参考已有实现）

### 前端组件拆分
- `agent-chat/` 模块：原 2600+ 行单文件拆为 ~20 文件（主组件 ~250 行 + 10 个 hooks + 各类 block 组件）
- `stock/` 模块：KLineChart / TimelineChart / MoneyFlow / StockFundamental 各司其职，shared/ 放复用组件
- `wechat/` 模块：WechatDialog / BotControlPanel / QRCodeAuth 三层

### 服务层拆分
- `electron/main/services/stock/` 模块：
  - `rate-limiter.ts` — 请求防御（令牌桶 + 滑动窗口 + 断路器）
  - `stock-service.ts` — 三数据源 API 封装
  - `stock-watchlist-service.ts` / `stock-data-service.ts` — JSON/JSONL 存储分离
  - `python-bridge.ts` — 守护进程管理
  - `formula-service.ts` — 公式 CRUD

### Agent 工具拆分
- `tools/tool-registry.ts` — 元数据注册表（聚合入口）
- 按业务域分文件：`book-qa-tools.ts` / `book-analysis-tools.ts` / `article-tools.ts` / `stock-tools.ts` / `stock-analysis-tools.ts` / `memory-tools.ts`
- 同一业务域的相关工具放一个文件，跨域不复用工具文件

### 拆分时机
- 单文件 >300 行 → 按职责拆分
- 涉及 3+ 独立责任 → 分别建 Service/Hook/Utility
- 工具集合超过 5 个 → 按业务域新建工具文件
- IPC 处理 + 业务逻辑 + 数据存储混杂 → 分成 tipc handler / Service / DAO 三层