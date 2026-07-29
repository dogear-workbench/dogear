# pi 运行时迁移设计（阶段一：后台任务）

**背景**

dogear 当前全部 AI 能力建在 `@anthropic-ai/claude-agent-sdk` 的 `query()` 上。该 SDK 本质是 spawn claude CLI 子进程 + 通过 stdin/stdout JSON 协议通信，暴露一个 async generator。它带来三个结构性限制：

1. **模型不自由**——只能通过 `ANTHROPIC_BASE_URL` 骗一个 Anthropic 兼容层，接不了 OpenAI / Gemini 原生格式。
2. **上下文不可控**——`systemPrompt: { preset: 'claude_code' }` 塞进一大坨永远在线的基础提示词，只能 append 不能替换。
3. **运行时不可控**——`query()` 是黑盒生成器，权限、插话、工具执行、压缩全是 SDK 定的协议，只能从外面观察消息流反推状态。现有代码里大量"绕路"（hooks 注入上下文、解析 `message.type` 反推状态）都源于此。

目标框架选定 pi（`earendil-works/pi`，原 `badlogic/pi-mono`）。其设计理念是「loop 归 loop，其余全是可选件」——核心只有 4 个工具、系统提示词 + 工具定义 < 1000 token，其余能力靠 extension 自建。

**目标**

- 阶段一：把三条后台一次性 query 链路（`GROUP_DIGEST_SESSION` / `REVIEW_SESSION` / `CATEGORIZE_SESSION`）从 Claude SDK 切到 pi，验证可行性并立刻兑现「后台任务用便宜模型」的收益。
- 长期：主会话也迁走，最终移除 `@anthropic-ai/claude-agent-sdk` 依赖。本文档只覆盖阶段一。

---

## 架构

### 依赖边界

只引入 pi 的两层，**不引入 `pi-coding-agent`**：

| 包 | 用途 | 取舍 |
|---|---|---|
| `@earendil-works/pi-ai` | provider 层。统一 30+ 家 LLM API（含 DeepSeek / ZAI 国内版 / Kimi / OpenRouter / llama.cpp），流式、tool calling、跨 provider 中途换模型、token/cost 统计 | ✅ 采用 |
| `@earendil-works/pi-agent-core` | loop 层。`Agent` 类持有 `messages/tools/model/systemPrompt`，跑 agentic 循环，提供 `beforeToolCall` / `afterToolCall` / `steer` / `followUp` / `convertToLlm` / `transformContext` 六个插槽 | ✅ 采用 |
| `pi-coding-agent` | 会话文件 / extension / skills / TUI | ❌ 为 CLI 场景设计，与 dogear 已有的对话树、组、工作区体系冲突 |
| `pi-tui` / `pi-storage-sqlite-node` / `pi-server` / `pi-evals` | 终端 UI / SQLite / 实验性 / 评测 | ❌ 不适用 |

两层解耦：`new Agent({ streamFn })` 的 `streamFn` 是注入的，后续可单独替换任一层。

### 排除的选项

- **抽一个同时兼容 SDK 和 pi 的 `AgentRuntime` 接口**——会被最小公倍数绑架，最后变成又一层限制，正是本次要摆脱的东西。改为新旧两套运行时各写各的，迁完一条删一条。
- **`pi --mode rpc` 子进程模式**——改动最小，但等于把 claude CLI 换成 pi CLI，仍然是黑盒，与「运行时可控」诉求相悖。
- **只用 pi-ai 自己写 loop**——loop 本身不难，但插话队列语义、工具并行执行、事件时序屏障（`message_end` 作为 tool preflight 的 barrier）这些细节自己磨代价不小，而 pi-agent-core 的插槽与 dogear 需求高度吻合。
- **第一步就给 `ModelProfile` 加 `apiFormat` 字段**——同时改数据模型 + 设置页 UI + 新引擎，出问题不好定位。阶段一只跑 anthropic 格式，`provider.ts` 写成「apiFormat 可选、缺省 anthropic」的形状，二期加字段是纯增量。

### pi 与 dogear 现有设计的对应关系

后续主会话迁移时可直接利用（阶段一用不到，此处记录以免遗忘）：

| dogear 现有能力 | pi 对应插槽 |
|---|---|
| 权限卡片（`canUseTool` + `PermissionResult`） | `beforeToolCall` 返回 `{ block: true, reason }` |
| 插话队列 `pendingMessages` + `pendingCountChanged` | `agent.steer()`（打断）/ `agent.followUp()`（排队），原生两种语义 |
| `isMeta` / `compact_boundary` / `task_summary` 等纯 UI 消息 | `CustomAgentMessages` 声明合并 + `convertToLlm` 过滤 |
| 压缩 | `transformContext` |
| fork / 对话树 | pi 的会话 JSONL 是**单文件内的树**（entry 带 `id` + `parentId`），格式值得直接抄 |

---

## 模块边界

### 新增

```
electron/main/agents/pi/
  provider.ts      # ModelProfile → pi Models/Model
  tool-adapter.ts  # 中立 ToolDef ⇄ SDK server / pi AgentTool 双向适配
  run-once.ts      # 一次性任务薄封装
```

### 修改

- `electron/main/agents/tools/` 下 5 个文件（阶段一涉及的 22 个工具）：从「直接返回 `createSdkMcpServer`」改为「先产出中立 `ToolDef[]`，由适配器决定注册成什么」。**handler 函数体一个字不改。**
  - `group-digest-tools.ts`（3）、`digest-tools.ts`（1）、`group-tools.ts`（3）
  - `review-tools.ts`（5）、`memory-tools.ts`（5）
  - `category-tools.ts`（5）
- `electron/main/agents/agent-worker.ts`：`handleGroupDigestTask` / `handleReviewSessionTask` / `handleCategorizeSessionTask` 三个方法的 query 调用段。prompt 组装、工具构造、`saved` 标志位回调、错误返回结构均不动。
- `.claude/rules/agent-development.md`：工具开发约定需同步（错误语义、注册方式）。

### 不动

`resolveModelSelection` / `buildQueryBaseConfig`（主会话仍在用）、三份提示词模板、`transcript-cleaner.ts` / `session-paths.ts`（消费的是主会话产出的 SDK JSONL，阶段一主会话不动）。

---

## 数据流

### 工具中立化

```ts
// pi/tool-adapter.ts
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;                                   // 继续用 zod，不换 TypeBox
  handler: (args: z.infer<S>) => Promise<ToolResult>;
}
type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export function toSdkServer(name: string, defs: ToolDef[]): McpServer;  // 旧引擎
export function toPiTools(defs: ToolDef[]): AgentTool[];                // 新引擎
```

`toPiTools` 负责两件转换：

1. **Schema**：`z.toJSONSchema(schema)`（zod 4.3.6 原生方法）→ 喂给 pi 的 `parameters`。pi 的 `TSchema` 本质就是 JSON Schema 对象。**这使得 63 个工具都不用重写 schema。**
2. **错误语义翻转**：SDK 约定返回 `isError: true`（禁止抛异常，会终止 loop）；pi 约定 `throw`（loop 捕获并转成 `isError` 的 toolResult）。适配器统一处理，工具作者两边都不用管。

`ToolDef` 这层桥有明确死期：迁移完成后删掉 `toSdkServer`，`ToolDef` 原地变成 pi 的 `AgentTool` 或留作本地约定。它只描述「一个工具长什么样」，不描述运行时，因此不存在抽象被绑架的问题。

### Provider 解析

现状是把 `ModelProfile` 摊成 `ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` 等环境变量，交给 claude CLI 子进程读取——通过环境变量隔空喊话。

pi 里没有子进程，直接建对象：

```ts
// pi/provider.ts
export function resolvePiModel(appSettings: AppSettings, selection: ModelSelection | null, ...) {
  // 复用与 resolveModelSelection 相同的三级 fallback 与「方案不完整即报错」校验
  const models = createModels();
  models.setProvider(createProvider({
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    auth: { apiKey: { name: profile.name, resolve: async () => ({ auth: { apiKey: profile.apiKey } }) } },
    models: [/* haikuModel / sonnetModel / opusModel 三条 */],
    api: anthropicMessagesApi(),
  }));
  return models.getModel(profile.id, tierMap[tier]);
}
```

`haiku / sonnet / opus` 的 tier 概念在 pi 里没有对应物（pi 直接选 model），会自然退化成「一个 profile 提供三个候选 model，selection 挑一个」。语义不变。

**对新引擎失效的 ModelProfile 字段**（阶段一不动，全部迁完后清理）：

- `disableNonessentialTraffic` — CLI 遥测开关，无对应物
- `autoCompactWindow` — CLI 自动压缩，我们不用 pi 的压缩层
- `apiTimeoutMs` — 改为在 pi 侧用 `AbortSignal.timeout` 自行实现
- `AppSettings.ai.subagentModelTier` — pi 无子代理概念

### 一次性任务执行

```ts
// pi/run-once.ts
export async function runOnce(opts: {
  systemPrompt?: string;
  prompt: string;
  tools: ToolDef[];
  model: Model;
  signal?: AbortSignal;
  maxTurns?: number;
  onLog?: (msg: string) => void;
}): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }>;
```

内部建 `Agent`、`subscribe` 转日志、`await agent.prompt(...)`、`signal` 上挂 `agent.abort()`。

`handleGroupDigestTask` 的替换：

- `query({...}) + for await` → `runOnce({...})`
- `env` → `model`
- `mcpServers` + `allowedTools` → `tools: [...defs]`（不传的工具就是不存在，比白名单更直接）
- `permissionMode: 'dontAsk'` → 删除（pi 不传 `beforeToolCall` 即全放行）

---

## 行为差异与边界情况

**1. `maxTurns` 消失 —— 必做项。** pi 的 loop 故意不设 max steps（作者原话：没找到用例）。后台任务若模型抽风反复调工具会无限跑、持续烧钱。必须自行补：用 `agentLoop` 的 `shouldStopAfterTurn` 回调，或在 `subscribe` 里计数 `turn_start`。

**2. 没有 `claude_code` preset 系统提示词。** 后台任务本就不依赖内置工具（Read/Bash 均未授予），影响远小于主会话，但模型会失去「我是个会调工具的 agent」的框架感。需在 `systemPrompt` 里补一段最小身份说明——这也是「上下文可控」的第一次兑现，能精确知道注入了哪几百 token。

**3. 工具名前缀。** SDK 是 `mcp__dogear-group-digest__ReadGroupDigest`，pi 是裸名 `ReadGroupDigest`。已核实：三份提示词模板（`group-digest-prompt.ts` / `review-prompt.ts` / `categorize-prompt.ts`）**均未使用 `mcp__` 前缀**，用的就是裸名，无需改模板。只需删除 `agent-worker.ts` 里的 `allowedTools` 数组。

**4. 模型质量风险（长期，非阶段一）。** `preset: 'claude_code'` 不只是啰嗦——Claude 模型在该 harness 上做过 RL 训练，工具命名、行为约定、输出风格都对齐过。pi 自己就故意把工具名改成 Claude Code 命名、并对 Anthropic 模型发送 Claude Code 的 version string 来蹭这份训练。扔掉它省下的 token 是真的，但 Claude 模型上可能有行为质量回退。对 OpenAI / Gemini / GLM 而言它本来就是负资产。阶段一影响小，主会话迁移时需重点评估。

**5. ESM。** 项目根 `"type": "module"`，Electron 主进程与 Worker 线程均为 ESM，pi 为纯 ESM 包，无 CJS 互操作问题。

**6. 错误与取消。** 现有 `this.currentAbortController` + `signal.aborted` 判定取消的逻辑保留，在 `runOnce` 里转成 `agent.abort()`。三个任务的返回结构（`{ groupId, saved, error?, cancelled? }`）不变，上层 trigger 与活动采集不受影响。

---

## 落地顺序

| 步 | 内容 | 验收 |
|---|---|---|
| 0 | 装 `pi-ai` + `pi-agent-core`，写最小脚本：用现有某 profile 的 anthropic 端点跑一次假工具 tool call 往返 | 能观察到 `toolcall_end` 事件、工具被执行、结果回传模型 |
| 1 | `tool-adapter.ts` + 22 个工具改为 `ToolDef`，**旧引擎继续走 `toSdkServer`** | `bun run build:electron` + `lint` 通过；手动触发一次组提炼，产出与改造前一致 |
| 2 | `provider.ts` + `run-once.ts`；`handleGroupDigestTask` 切 pi；补 maxTurns 保护与 systemPrompt 身份段 | 对真实脏组触发重新提炼，**比对新旧组卡质量**（唯一真正重要的验收） |
| 3 | `handleReviewSessionTask` / `handleCategorizeSessionTask` 照抄 | 同上 |

第 1 步独立可交付：单独就能 build 通过、行为零变化。即使后续 pi 走不通，该步改动也不需回滚。

**回退**：不在代码里留开关（项目约定开发阶段不做兼容层），靠 git 分支回退。

**验证方式**：`bun run build:electron` + `bun run lint` + 手测。项目不写单测。

---

## 未决问题

> ✅ 以下全部在 step3-step4 实施阶段回填结论。

1. **pi `Model` 描述符的具体必填字段**：必填 `id / name / api / provider / baseUrl / reasoning / input / cost / contextWindow / maxTokens`。实测 `contextWindow: 200_000 / maxTokens: 8192 / cost 全 0 / reasoning: false`，`maxTokens` 直接作为请求体的 `max_tokens` 字段发出，不可省略。
2. **`anthropicMessagesApi()` 的确切导出路径**：`@earendil-works/pi-ai/api/anthropic-messages.lazy`（`node` moduleResolution 认不出 `package.json` exports 子路径，需改 `bundler`）。
3. **`z.toJSONSchema()` 的产物能否被 pi 接受**：✅ 可用。适配器用 zod `parse()` 做校验，pi 接收已解析参数，绕过 TypeBox。所有工具均通过冒烟测试和真实链路验证。
4. **后台任务是否用 systemPrompt + prompt 两段**：阶段一保持等价——模板仍走 `prompt`（user turn），`systemPrompt` 只放最小身份段（一句话）。prompt cache 优化留二期。
5. **`apiTimeoutMs` 在 pi 侧的落点**：改为 per-request 超时，直接透传给 `streamSimple` 的 `timeoutMs` 参数。整轮墙钟上限改由 `maxTurns=30` 兜底，理由见 step3 实施回填。

## 供应链风险

pi 包名刚从 `@mariozechner/*` 迁至 `@earendil-works/*`（VC 支持的公司接手），仓库 README 首行声明「新贡献者的 issue 和 PR 默认自动关闭」。出问题基本靠自行阅读源码解决。好在采用的两个包体量都不大，且两层解耦、可分别替换。
