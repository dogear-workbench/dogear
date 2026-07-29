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
- [x] [Step 3: GROUP_DIGEST 切 pi](./step3-group-digest-to-pi.md) — `provider.ts` + `run-once.ts`，第一条链路真实切换
- [x] [Step 3.5: 组卡引用保真度校验](./step3.5-source-fidelity-guard.md) — 插入步：step3 验收测出 sources uuid 编造 9/40，补确定性校验后再往下切。实测保真度 73% → 100%
- [x] [Step 4: review + categorize 切 pi](./step4-review-categorize-to-pi.md) — 剩下三个 handler 照抄，收尾清理

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

## 完成总结

**阶段一收尾时间**：2026-07-29

**实际改动汇总**

| 文件 | 性质 | 说明 |
|---|---|---|
| `electron/main/agents/pi/provider.ts` | step3 新建，本步不改 | `resolvePiModel` + `buildPiModels` |
| `electron/main/agents/pi/run-once.ts` | step3 新建，step4 小改 | 新增 `tool_execution_end` 错误日志 |
| `electron/main/agents/pi/tool-adapter.ts` | step2 新建，本步不改 | |
| `electron/main/agents/agent-worker.ts` | 主改文件 | 三个 handler 切 pi，清理 3 处 SDK 动态 import |

**与原设计的偏差**
- `tool_execution_end` 事件确认携带 `isError: boolean` + `result: any`，可直接用于错误日志（step3 未订阅的判断「无信息增量」有误，现已补上）
- 取消路径语义统一：`runOnce` 不抛出，取消以 `{ ok: false, cancelled: true }` 返回；`handleCategorizeSessionTask` 的外层 catch 取消检查因此简化（不再依赖 `abortController.signal.aborted`）
- `buildQueryBaseConfig` 三个 handler 仍保留调用（读 `appSettings` 的三级 fallback），但不再使用 `env` / `effort` / `pathToClaudeCodeExecutable` 字段

**还在用 SDK 的地方**
- `PARSE_ARTICLE` 链路（`agent-worker.ts:395`）——依赖 SDK 的 plugins skill 发现机制，阶段一保留
- 主会话（`query-based-session.ts`）——阶段一不动

**二期待做**
- 主会话迁移：需先对齐 `plugins` skill 发现机制的替代方案
- `apiFormat` 字段：二期加字段时 `provider.ts` 已预留形状
- `ModelProfile` 中的 `disableNonessentialTraffic` / `autoCompactWindow` / `subagentModelTier` 字段在 pi 里无用，迁移完成后统一清理
- prompt cache 优化：模板移进 `systemPrompt` 段
