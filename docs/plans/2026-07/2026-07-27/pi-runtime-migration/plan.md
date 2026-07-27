# pi 运行时迁移（阶段一：后台任务）实施计划

**设计文档**：[../pi-runtime-migration-design.md](../pi-runtime-migration-design.md)（背景、取舍、排除的选项都在那里，本文件只讲怎么落）

**目标**：把后台四条一次性 query 链路从 `@anthropic-ai/claude-agent-sdk` 切到 pi（`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`），验证可行性并兑现「后台任务可自由选模型」的收益。主会话不动。

**架构思路**：只引入 pi 的 provider 层和 loop 层，不引入 `pi-coding-agent`。**不抽「同时兼容 SDK 和 pi 的运行时抽象」**——只中立化工具定义（`ToolDef`），运行时两套各写各的，迁完一条删一条。工具 schema 继续用 zod，靠 `z.toJSONSchema()` 转成 pi 要的 JSON Schema，63 个工具的 schema 一行不用重写。

**涉及模块**：
- 新增 `electron/main/agents/pi/`（`provider.ts` / `tool-adapter.ts` / `run-once.ts`）
- 改 `electron/main/agents/tools/` 下 6 个文件（22 个工具）
- 改 `electron/main/agents/agent-worker.ts` 四个 handler 的 query 调用段
- 改 `.claude/rules/agent-development.md`（工具开发约定）

## 步骤索引

- [x] [Step 1: pi 最小验证](./step1-pi-smoke-test.md) — 装包，用现有 profile 的 anthropic 端点跑通一次 tool call 往返，核实设计文档里 5 个未决项
- [x] [Step 2: 工具定义中立化](./step2-tool-def-neutralize.md) — 22 个工具改成 `ToolDef[]`，旧引擎继续走 `toSdkServer`，行为零变化
- [ ] [Step 3: GROUP_DIGEST 切 pi](./step3-group-digest-to-pi.md) — `provider.ts` + `run-once.ts`，第一条链路真实切换
- [ ] [Step 4: review + categorize 切 pi](./step4-review-categorize-to-pi.md) — 剩下三个 handler 照抄，收尾清理

> 步骤编号与设计文档的「落地顺序」表对应关系：step1↔步0、step2↔步1、step3↔步2、step4↔步3。

## 全局决策

**依赖边界**
- 只用 `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`。不引入 `pi-coding-agent` / `pi-tui` / `pi-storage-sqlite-node`。
- 两层解耦：`new Agent({ streamFn })` 的 `streamFn` 注入，后续可单独换任一层。

**不做的事**
- 不抽 `AgentRuntime` 之类同时兼容两个引擎的运行时接口。
- 不在代码里留 feature flag / 双跑开关（项目约定：开发阶段不做兼容性代码）。回退靠 git 分支。
- 阶段一不给 `ModelProfile` 加 `apiFormat` 字段，只跑 anthropic 格式。`provider.ts` 写成「apiFormat 可选、缺省 anthropic」的形状，二期加字段是纯增量。
- 阶段一不动主会话（`query-based-session.ts`）、不动 `PARSE_ARTICLE` 链路（它依赖 SDK 的 `plugins` skill 发现机制，pi 没有对应物，留到后面单独处理）。

**工具约定**
- `ToolDef.schema` 继续用 zod，**不换 TypeBox**。
- 错误语义由适配器统一翻转：工具 handler 一律沿用现有约定返回 `{ content, isError: true }`；`toPiTools` 负责在 pi 侧转成 `throw`。工具作者两边都不用管。
- 每个工具文件顶部的 `registerTools()` 元数据注册**不动**（设置页动态加载依赖它）。
- 工具名在 pi 里是裸名（`ReadGroupDigest`），不带 `mcp__server__` 前缀。已核实三份提示词模板均未使用前缀，无需改模板。

**回归红线**
- `memory-tools.ts`（dogear-memory，常驻工具包）和 `group-tools.ts`（dogear-group，working agent 写 `_notes/` 用）**主会话也在用**。改这两个文件时，`toSdkServer` 必须产出与改造前完全一致的 MCP server，任何签名/描述/行为漂移都会影响主会话。

**必做的行为补偿**（切 pi 时逐项落实）
1. **轮次上限**：pi 的 loop 故意没有 max steps，必须自己补（`shouldStopAfterTurn` 或 `subscribe` 里数 `turn_start`），否则后台任务可能无限调工具烧钱。
2. **systemPrompt 身份段**：没有 `claude_code` preset 了，需补一段最小身份说明。
3. **`allowedTools` 白名单删除**：pi 里不传的工具就是不存在，语义更直接。注意 `group-tools` 有 3 个工具但 digest 任务只授权 2 个（不给 `WriteGroupFile`），切 pi 时按实际授权列表传 defs。

**验证方式**
- `bun run build:electron` + `bun run lint`，加手测。项目不写单测。
- 每一步的真正验收是「产出物质量比对」，不是「代码能跑」。
