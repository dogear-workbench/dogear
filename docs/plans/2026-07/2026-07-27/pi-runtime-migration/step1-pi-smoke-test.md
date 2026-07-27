---
step: 1
title: pi 最小验证
status: done
---

## 目标

装上 pi 两个包，用现有某个 `ModelProfile` 的 anthropic 端点跑通一次完整的 tool call 往返，把设计文档里 5 个未决项全部核实成事实。**这一步不碰任何现有代码**，产出是一份「已核实事实」清单交给 step2/step3。

## 依赖上下文（接力棒输入）

无前置步骤。需要知道的现状：

- 项目根 `package.json` 有 `"type": "module"`，Electron 主进程与 Worker 线程均为 ESM，pi 是纯 ESM 包，无 CJS 互操作问题。
- 包管理器是 **Bun**，不用 npm。
- 现有模型配置结构 `ModelProfile`（`electron/main/services/settings-types.ts:26`）：
  ```ts
  { id, name, apiKey, baseUrl, haikuModel, sonnetModel, opusModel, apiTimeoutMs, disableNonessentialTraffic, autoCompactWindow? }
  ```
  全部是 **Anthropic 兼容端点**（现在摊成 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 等环境变量喂给 claude CLI 子进程）。
- 真实的 profile 配置在 `.dogear/settings.json` 的 `profiles` 字段，可直接读一个来测。

## 计划改动

- [ ] `bun add @earendil-works/pi-ai @earendil-works/pi-agent-core`
- [ ] 写临时脚本（如 `scripts/pi-smoke.ts`，**本步结束后删除**，项目约定不留半成品）：
  - [ ] 从 `.dogear/settings.json` 读一个 profile，用 `createProvider()` + `createModels()` 构造 Model（baseUrl / apiKey / 三个 tier 的 modelId）
  - [ ] 定义一个假工具（比如 `Echo`，zod schema `{ text: z.string() }`），schema 经 `z.toJSONSchema()` 转换后喂给 pi
  - [ ] `new Agent({ initialState: { systemPrompt, model, tools }, streamFn: models.streamSimple.bind(models) })`
  - [ ] `agent.subscribe()` 打印全部事件类型
  - [ ] `await agent.prompt('调用 Echo 工具，参数 text 传 hello')`
- [ ] 用 `bun scripts/pi-smoke.ts` 跑，确认能看到 `toolcall_end` → 工具被执行 → toolResult 回传 → 模型给出最终回复
- [ ] 核实完成后删除临时脚本

## 必须核实并记录的 5 个未决项

这是本步的**主要产出**，逐项写进下面的「实施回填」：

1. **`Model` 描述符的必填字段** —— `createProvider({ models: [...] })` 里每条 model 到底要哪些字段（id / name / contextWindow / maxTokens / cost / capabilities / reasoning 支持标记等）。记录完整形状。
2. **anthropic API 工厂的确切导出路径** —— README 只给了 `openAICompletionsApi` 来自 `@earendil-works/pi-ai/api/openai-completions.lazy`，anthropic 版的路径需要翻 `node_modules/@earendil-works/pi-ai` 的 `package.json` exports 字段或 d.ts 确认。
3. **`z.toJSONSchema()` 的产物 pi 吃不吃** —— 重点看 pi 的 `validateToolCall`（TypeBox `Value.Check`）对纯 JSON Schema 的兼容度。**兜底方案**：适配器绕过 pi 校验，改用 zod 自身 `parse()`（handler 本来就需要 typed args）。记录实际走了哪条路。
4. **`apiTimeoutMs` 的落点** —— pi 的 `stream()` options 里有没有超时字段；没有就确认用 `AbortSignal.timeout()` 包在 `runOnce` 层。
5. **轮次上限的实际写法** —— `Agent` 类上有没有直接的钩子，还是必须降到 `agentLoop()` 用 `shouldStopAfterTurn`，或者在 `subscribe` 里数 `turn_start` 后调 `agent.abort()`。记录选定方案和代码片段。

## 额外要顺手确认的

- [ ] pi 的 `Usage` 结构（`AssistantMessage.usage`）字段名，为后续 usage 采集迁移铺路（阶段一不接，只记录）。
- [ ] 在 **worker_threads Worker 里** 动态 `import()` pi 是否正常（`agent-worker.ts` 是在 Worker 线程跑的）。如果 smoke 脚本是主线程跑的，额外补一个 Worker 里的验证。

## 验收

- 临时脚本能完整跑完一次 tool call 往返并打印模型最终回复。
- 5 个未决项全部有明确结论（不能留「大概是」）。
- 临时脚本已删除，`git status` 只剩 `package.json` / `bun.lock` 的依赖变更。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：无。临时脚本 `scripts/pi-smoke.ts` 已按约定删除。
- 改动文件清单：`package.json`（+2 依赖）、`bun.lock`

### 已核实事实

1. **`Model` 描述符字段**：以下全部必填，缺一个 TS 就报错
   ```ts
   { id, name, api: "anthropic-messages", provider, baseUrl,
     reasoning: boolean, input: ("text"|"image")[],
     cost: { input, output, cacheRead, cacheWrite },
     contextWindow, maxTokens }
   ```
   可选：`thinkingLevelMap` / `headers` / `compat` / `cost.tiers`。内部用途 `cost` 全填 0 即可。

2. **anthropic API 工厂导出路径**：
   ```ts
   import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
   const api = anthropicMessagesApi(); // 返回 ProviderStreams（stream + streamSimple）
   ```
   非懒加载版：`@earendil-works/pi-ai/api/anthropic-messages` 直接导出 `stream` / `streamSimple`。

3. **`z.toJSONSchema()` 兼容性**：**直接兼容，不走兜底**。pi 的 `validateToolArguments` 检查 schema 上的 `TYPEBOX_KIND` symbol，没有就走 `coerceWithJsonSchema` + TypeBox `Compile(plainJsonSchema)` 分支。实测 zod → JSON Schema 全程无报错。

4. **`apiTimeoutMs` 落点**：`StreamOptions.timeoutMs` 已内置，不需要 `AbortSignal.timeout()`。
   ```ts
   streamFn: (model, ctx, opts) => models.streamSimple(model, ctx, { ...opts, timeoutMs: profile.apiTimeoutMs })
   ```

5. **轮次上限方案**：`Agent` 构造器**不暴露** `shouldStopAfterTurn`（那是底层 `agentLoop()` 的 `AgentLoopConfig` 字段）。唯一正路是 subscribe + abort：
   ```ts
   let turnCount = 0;
   agent.subscribe(async (e) => {
     if (e.type === "turn_start" && ++turnCount > MAX_TURNS) agent.abort();
   });
   ```
   `abort()` 会中断当前请求、loop 以 `aborted` stopReason 退出、`agent_end` 带截至当前的 messages。
   ⚠️ 一次 tool call 往返 = **2 轮**（工具执行后模型自动再跑一轮出最终回复），maxTurns 要算进去。

6. **`Usage` 结构**（`AssistantMessage.usage`，已是 camelCase）：
   ```ts
   { input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?,
     totalTokens, cost: { input, output, cacheRead, cacheWrite, total } }
   ```
   非思考模型 `reasoning === undefined`。对应 SDK 的 `cache_read_input_tokens` / `cache_creation_input_tokens`。

7. **Worker 线程里加载 pi**：完全正常，`agent-worker.ts` 无需任何特殊处理。实测 Worker 内 `import()` 两个包 + `createModels()` + `new Agent()` 均 ok。

### 给下一步的接力棒

- **pi 版本号**：`@earendil-works/pi-ai@0.82.1` + `@earendil-works/pi-agent-core@0.82.1`

- **构造 Model / Provider 的最小片段**：
  ```ts
  import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
  import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";

  function buildPiModel(profile: ModelProfile, modelId: string): Model<"anthropic-messages"> {
    return {
      id: modelId,
      name: `${profile.name}/${modelId}`,
      api: "anthropic-messages",
      provider: profile.id,
      baseUrl: profile.baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    };
  }

  const provider = createProvider({
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    auth: { apiKey: { name: "API Key", resolve: async () => ({ auth: { apiKey: profile.apiKey } }) } },
    models: [/* haiku/sonnet/opus 三条 */],
    api: anthropicMessagesApi(),   // 多 API 时传 { "anthropic-messages": api }
  });
  const models = createModels();
  models.setProvider(provider);
  ```

- **`ToolDef` → pi `AgentTool` 转换要点**：
  ```ts
  export function toPiTools(defs: ToolDef[]): AgentTool[] {
    return defs.map((def) => ({
      name: def.name,
      label: def.name,                          // label 必填（AgentTool 比 Tool 多这个字段）
      description: def.description,
      parameters: z.toJSONSchema(def.schema),   // 直接传 JSON Schema
      execute: async (toolCallId, params) => {
        const result = await def.handler(def.schema.parse(params));
        if (result.isError) throw new Error(result.content.map(c => c.text).join("\n"));
        return { content: result.content, details: null };
      },
    }));
  }
  ```
  - `execute` 签名：`(toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>`
  - 错误语义翻转在适配器里做：handler 返回 `isError: true` → 适配器 `throw`
  - 工具名裸名，不带 `mcp__server__` 前缀

- **踩到的坑 / 与设计文档不符之处**：
  1. 设计文档写「`shouldStopAfterTurn` 或 subscribe 二选一」——实际 `Agent` 类没有前者，只能 subscribe。
  2. 设计文档写超时用 `AbortSignal.timeout()` 包 `runOnce`——实际 `StreamOptions.timeoutMs` 已内置，更简洁。
  3. `z.toJSONSchema()` 产出带 `additionalProperties: false`，实测没问题；若将来模型多发字段出错，可在转换后删掉该字段。
  4. `provider.ts` 的 `auth.apiKey.resolve` 写法与设计文档样板完全一致，无坑。
