---
paths:
  - "electron/main/agents/**/*.ts"
  - "electron/main/services/stock/python-bridge.ts"
  - "python/**/*.py"
---

# Agent 开发规则

## 通用原则

- 全部 AI 能力（主会话、子会话、五条后台一次性任务）统一走 `@earendil-works/pi-agent-core` 的 AgentHarness，运行时门面是 `electron/main/agents/pi-session/` 下的 `PiSession`/`PiSessionManager`，优先在此基础上扩展
- Agent 与渲染层通信通过 `electron/main/tipc/renderer-handlers.ts` 中定义的事件，不要自建 channel

## 目录约定

- `electron/main/agents/tools/` — 自定义 Agent 工具（in-process MCP server，通过 `createSdkMcpServer` 注册）
- `electron/main/agents/pi-session/` — pi 运行时会话门面（PiSession/PiSessionManager/权限规则/skill 加载等），TIPC 和渲染层只能通过它访问，不得直接使用 Harness 类型
- `.claude/skills/` — Claude Code 标准 skill（SKILL.md + 资源），用于流程编排和工具元指南，与上面的运行时代码是两个不同概念，不要混淆

## 工具开发

- 每个工具文件末尾必须调用 `registerTools()` 注册元数据（name/description/server/category），供设置页动态加载
- 工具命名遵循 SDK 约定：`mcp__{server_name}__{tool_name}`，server_name 在 `createSdkMcpServer` 时指定
- 输入参数用 Zod schema 严格校验
- 错误情况返回 `isError: true`，不要抛异常（会终止 Agent 循环）

### ToolDef 中立化约定

主会话（及子会话）与四条后台一次性任务（GROUP_DIGEST / REVIEW / CATEGORIZE / CATEGORIZE_ORGANIZE）都已跑在 pi 运行时上，只有 PARSE_ARTICLE 仍在 SDK；工具定义已与运行时解耦（`electron/main/agents/pi/tool-adapter.ts`）。新写工具按这个形状：

```ts
export function createXxxToolDefs(...闭包参数): ToolDef[] {
  return [
    defineTool('ToolName', '描述', z.object({ foo: z.string() }), async (args) => { ... }),
  ];
}

// 需要给 SDK 用时包一层薄壳，对外签名不变
export function createXxxTools(...同样的参数) {
  return toSdkServer('dogear-xxx', '1.0.0', createXxxToolDefs(...));
}
```

- `schema` 用 `z.object({...})`（不是裸 shape）——`toSdkServer` 内部取 `.shape` 还原给 SDK 的 `tool()`，`toPiTools` 走 `z.toJSONSchema()` 喂给 pi
- handler 一律沿用 `isError: true` 约定，**两个运行时都不用管**——`toPiTools` 负责在 pi 侧翻转成 `throw`
- pi 侧工具名是裸名（`ReadGroupDigest`），不带 `mcp__server__` 前缀；提示词里引用工具名时注意区分运行时
- pi 的 loop 故意没有轮次上限，新起 pi 链路一律走 `pi/run-once.ts` 的 `runOnce()`——它已封好轮次上限、取消信号、`[tool-error]` 日志前缀，别自己 `new Agent()` 重写一遍
- 单个工具文件超过 5 个工具或 300 行时，按功能域拆分（参考 `stock-tools.ts` / `stock-analysis-tools.ts` 的拆分）

## Python 计算层（股票分析）

- Python 守护进程通过 `electron/main/services/stock/python-bridge.ts` 通信（JSON-RPC，stdin/stdout）
- 修改 `python/core/*.py` 的接口时，同步更新 python-bridge 的 method 列表和 stock-analysis-tools 的工具描述
- Python 端不引入 stdout 输出（会污染 JSON-RPC 协议），用 stderr 或日志文件
- 开发模式下 `python/**/*.py` 改动会自动重启守护进程（有请求在跑时等跑完再重启），不必手动重启 dogear；打包后不生效
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
- 按业务域分文件：`book-qa-tools.ts` / `book-analysis-tools.ts` / `article-tools.ts` / `stock-tools.ts` / `stock-analysis-tools.ts` / `stock-announcement-tools.ts` / `memory-tools.ts`
- 同一业务域的相关工具放一个文件，跨域不复用工具文件

### 拆分时机
- 单文件 >300 行 → 按职责拆分
- 涉及 3+ 独立责任 → 分别建 Service/Hook/Utility
- 工具集合超过 5 个 → 按业务域新建工具文件
- IPC 处理 + 业务逻辑 + 数据存储混杂 → 分成 tipc handler / Service / DAO 三层