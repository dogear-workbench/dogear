---
step: 3
title: GROUP_DIGEST 切 pi
status: done
---

## 目标

建 `provider.ts` + `run-once.ts`，把 `handleGroupDigestTask` 从 SDK `query()` 切到 pi。这是**第一条真实切换的链路**，验收标准是新旧组卡的质量比对，不是「代码能跑」。

## 依赖上下文（接力棒输入）

**来自 step1**：`Model` 描述符字段、anthropic API 工厂导出路径、轮次上限方案、`apiTimeoutMs` 落点。
**来自 step2**：`createGroupDigestToolDefs` / `createDigestToolDefs` / `createGroupToolDefs` 的签名，以及 `toPiTools` 的最终形状。

**目标 handler 的现状**（`agent-worker.ts:569` `handleGroupDigestTask`，共 ~150 行）：

结构是清晰的五段，**只有第 4 段要改**：

1. `:571-575` 解 payload（workspaceId / workspacePath / groupId / dirtyConversations / hasExistingCard）→ 不动
2. `:576-600` 模型解析：`buildQueryBaseConfig` → 三级 fallback `payload.modelSelection ?? digestModelSelection ?? defaultModelSelection` → `resolveModelSelection` 拿 `env` / `tier` / `profile`，失败返回 `{ groupId, saved: false, error }` → **改这里的产出物：env → Model**
3. `:602-667` 构造三个 MCP server（含 `saved` / `backgroundSaved` 标志位回调）+ 组装 prompt（模板 + contextSection：sourcesSeen / 共享区文件清单 / `_notes/` 清单 / 分类词汇表）→ **只改工具构造那几行，prompt 组装完全不动**
4. `:669-704` `AbortController` + `query({...})` + `for await` 空转 → **整段替换成 `runOnce`**
5. `:706-718` 日志 + 返回 `{ groupId, saved, backgroundSaved, tier, profileName }` / 取消分支 / 错误分支 → 不动

现有 query options（`:673-698`）：`permissionMode: 'dontAsk'`、`env`、`abortController`、`effort`（haiku 档位不传，会 API 400）、`pathToClaudeCodeExecutable`、`mcpServers` ×3、`allowedTools` ×6。

**授权范围**：`group-tools` 定义了 3 个工具，但本任务的 `allowedTools` 只给了 `ListGroupFiles` + `ReadGroupFile`——**不给 `WriteGroupFile`**。切 pi 时按这个实际授权列表传 defs，不要全传。

## 计划改动

### 1. 新建 `electron/main/agents/pi/provider.ts`

```ts
export function resolvePiModel(
  appSettings: AppSettings,
  selection: ModelSelection | null,
  subAgentFallback: ModelSelection | null,
  fallback: ModelSelection | null,
): PiModelResult;  // { model: Model<'anthropic-messages'>; profile: ModelProfile; tier: ModelTier }
```

- [x] 三级 fallback 与「方案不存在 / 配置不完整即抛错」的校验逻辑，与 `agent-query-config.ts:136` `resolveModelSelection` 保持一致（可提取共用，也可平行实现——**不要改动 `resolveModelSelection` 本身**，主会话还在用）→ 采平行实现，`resolveModelSelection` 未动
- [x] `createProvider({ id: profile.id, name: profile.name, baseUrl: profile.baseUrl, auth: {...profile.apiKey}, models: [三个 tier], api: anthropicMessagesApi() })`
- [x] ~~预留 `apiFormat` 分支的形状~~ → **有意不做**：直接硬编码 `Model<'anthropic-messages'>` + `anthropicMessagesApi()`。阶段一只跑 anthropic 格式，预留分支属于「为假想需求提前抽象」，违反项目「开发阶段不做兼容性代码」约定。step4 三个 handler 同样只走 anthropic
- [x] `disableNonessentialTraffic` / `autoCompactWindow` / `subagentModelTier` 在此处显式忽略并加一行注释说明原因（迁移完毕后统一清理）

### 2. 新建 `electron/main/agents/pi/run-once.ts`

```ts
export async function runOnce(opts: {
  systemPrompt?: string;
  prompt: string;
  tools: ToolDef[];
  model: Model<'anthropic-messages'>;
  profile: ModelProfile;          // 计划外新增：用于建 provider + 取 apiTimeoutMs
  signal?: AbortSignal;
  maxTurns?: number;              // 默认 30
  onLog?: (msg: string) => void;
}): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }>;
```

- [x] 内部建 `Agent`（`initialState: { systemPrompt, model, tools: toPiTools(opts.tools) }`，`streamFn` 包一层箭头函数注入 `timeoutMs`，非 `bind`）
- [x] `agent.subscribe()` 把 `tool_execution_start` / `agent_end` 转成 `onLog`（`tool_execution_end` 未接——每个工具打两条日志无额外信息量）
- [x] **轮次上限**：`turn_start` 计数，超 `maxTurns` 时 `agent.abort()` 并返回 `{ ok: false, error: '超过最大轮次 N' }`。事件名已核实存在于 `pi-agent-core` 的 `AgentEvent` 联合类型，冒烟测试实测计数生效
- [x] `opts.signal` 上挂 `agent.abort()`，用 `cancelled` 标志区分「主动取消」与「真实错误」
- [x] ~~`timeoutMs` 用 `AbortSignal.timeout()`~~ → **改为 per-request 超时**：收 `profile`，把 `profile.apiTimeoutMs` 透传给 `streamSimple` 的 `timeoutMs`（`SimpleStreamOptions` 的合法字段）。语义从「整轮墙钟上限」变为「单次 HTTP 请求超时」，理由见回填

### 3. 改造 `handleGroupDigestTask`

- [x] 第 2 段：`resolveModelSelection` → `resolvePiModel`，`env` 不再需要；`tier` 仍要（返回值里带、日志里打）。失败分支的返回结构不变
- [x] 第 3 段：`createGroupDigestTools(...)` → `createGroupDigestToolDefs(...)`，其余两个同理；`saved` / `backgroundSaved` 回调透传方式不变
- [x] 第 4 段整段替换：
  ```ts
  const result = await runOnce({
    systemPrompt: /* 见下方「身份段」 */,
    prompt,                                   // 第 3 段组装的，原样不动
    tools: [...digestDefs, ...transcriptDefs, listGroupFiles, readGroupFile],  // 注意不含 WriteGroupFile
    model,
    signal: abortController.signal,
    maxTurns: /* 定一个保守值，建议 30 */,
    onLog: (m) => taskLogger.info(m),
  });
  ```
- [x] 删掉 `permissionMode` / `env` / `effort` / `pathToClaudeCodeExecutable` / `mcpServers` / `allowedTools` 六项
- [x] `effort` 的处理：pi 用 `thinkingLevel`（`'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`）而非 SDK 的 `effort`。后台提炼任务默认档位低，**本步先不接 thinking，保持最简**；若产出质量下降再补，并在回填里记录
- [x] 授权范围核对：`runOnce` 实收 6 个工具（ReadGroupDigest / SaveGroupDigest / SaveGroupBackground / CleanTranscript / ListGroupFiles / ReadGroupFile），与旧 `allowedTools` 六项逐一对应，`WriteGroupFile` 已由 `.filter()` 排除，无授权放大

### 4. systemPrompt 身份段（必做补偿）

- [x] 现在整份模板是当 user prompt 发的（`query({ prompt })`），`systemPrompt` 为空。**本步保持这个等价性**——模板仍走 `prompt`，`systemPrompt` 只放一小段最小身份说明（说明它是个能调工具的后台整理 agent、工具用裸名、完成后直接结束不要寒暄）
- [x] 「模板挪进 systemPrompt 吃 prompt cache」是**二期优化**，本步不做，避免同时改两个变量

## 验收

- [x] `bun run build:electron` + `bun run lint` 通过（0 error / 83 warning 全为存量）
- [x] **pi 连通性冒烟**（计划外补充，用完即删的 `scripts/pi-smoke.mjs`）：对真实 profile 发一次带工具的请求，验证「模型名解析 → 认证头 → 工具回环 → 轮次计数」四环。结果 `model.id=glm-4.7` / `x-api-key` 被 GLM 端点接受 / `Echo` 工具往返成功 / 2 轮结束 / 3.9s。**这一步是必要的**：它把「底层连通性」和「提炼质量」两类问题隔离开，否则后者出问题时无法归因
- [x] ~~逐字比对新旧 `digest.md`~~ → **无法执行**：5 份基线组卡引用的会话 JSONL 均已被清理，跑保真度得 0% 是「查无此文件」而非「编造」，作废。改为对 pi 产出做**绝对值校验**，结论见回填
- [x] `background.md` 四字段（topic / progress / keyDecisions / openQuestions）正常产出（`group_a2153547` 3.5KB / `group_2977a10a` 2.3KB，四字段齐全）
- [x] 设置页「会话摘要」Tab 的活动状态、进度、**停止按钮**都正常（取消路径走的是 `agent.abort()`，必须实测）→ **step3.5 实测掉了**：停止按钮命中，`outcome: error / "已取消" / 9.9s`，活动记录正常入 recent
- [ ] 故意配一个错误的 profile（比如清空 apiKey），确认错误分支返回结构不变、UI 显示正常 → **未做**，顺延到 step4

## 已知风险

- **保真度回归**：`sources` 里的 `sessionId#uuid` 必须来自真实逐字稿。没有 `claude_code` preset 后模型编造的倾向可能上升，这是比对时的**第一检查项**（对应记忆里的「AI 提炼要保真」约定）。
- **轮次上限误伤**：组内会话多时 `CleanTranscript` 要调很多次，上限设太小会截断提炼。先设宽松（30），观察实际用了几轮再收。

## 实施回填

### 实际改动

**改动文件清单**

| 文件 | 性质 |
|---|---|
| `electron/main/agents/pi/provider.ts` | 新建，86 行 |
| `electron/main/agents/pi/run-once.ts` | 新建，72 行 |
| `electron/main/agents/agent-worker.ts` | 改 `handleGroupDigestTask` 第 2/3/4 段 + 一条 type-only import |
| `tsconfig.electron.json` | `moduleResolution` 从 `node` 改 `bundler` |

`tsconfig` 那条是计划里没预见的**硬约束**：pi-ai 的 API 实现走 `package.json` 的 `exports` 子路径（`@earendil-works/pi-ai/api/anthropic-messages.lazy`），`node` 解析模式认不出来。step4 不用再改。

**与计划的四处差异**（前两条已在上文 checklist 就地标注）

1. 不预留 `apiFormat` 分支 —— 有意为之，见上
2. `tool_execution_end` 未接 —— 无信息增量
3. **超时语义**：per-request 取代整轮墙钟。决策理由：整轮上限定小了会误杀会话多的大组提炼（这类任务合法地要跑很久），定大了又等于没有；而 `maxTurns=30` 已经是「失控」这个真实风险的兜底，墙钟只是重复保险。`profile.apiTimeoutMs` 还能直接继承用户既有配置，不新增旋钮
4. **`Model` 描述符含一批计划外硬编码**：`maxTokens: 8192` / `contextWindow: 200_000` / `cost` 全 0 / `reasoning: false`。pi 的 `Model` 是纯数据描述符，这些字段必填。其中只有 `maxTokens` 有实际行为影响——它作为 `max_tokens` 发出去（`anthropic-messages.js:713`）。**决定先保留 8192**：现存组卡实测 0.5–1.5KB（约 500 token），余量充足；而调大对 max_tokens 上限低的 profile（deepseek 是 8k）会直接 400，反而要加按 profile 分档的逻辑。若测出截断再回头改

**修掉的一个必现 bug**：`buildPiModel` 原先把 `Model.id` 写成 `${profile.id}/${tier}`（如 `default/opus`），传入的真实 `modelId` 参数被忽略。而 pi 是直接把 `model.id` 当请求体的 `model` 字段发出去的，等于每次请求都在报一个不存在的模型名。同时把 `agent-worker.ts` 里为绕开类型问题加的 `let model: any` + `eslint-disable` 换成了 `PiModelResult['model']`。

### 组卡质量比对结论

真实提炼已跑通（应用重新发布后**自动**触发，非手动）。产出两份组卡：`group_a2153547`（03:27 建 / 04:34 增量，12.3KB）、`group_2977a10a`（03:24，4.9KB）。

**新旧差异：无法比对。** `C:/tmp/pi-step3-baseline/` 的 5 份基线全部作废——它们 `sourcesSeen` 里的会话 JSONL 已被清理，对其跑保真度得 0%，是「查无此文件」不是「编造」。**教训：存基线时必须连同源 JSONL 一起快照，否则基线只是一份无法验证的文本。**

**保真度（绝对值校验，用全库 uuid 索引比对）**

| 组卡 | 引用数 | 正确 | 张冠李戴 | 编造 | 保真 |
|---|---|---|---|---|---|
| `group_2977a10a` | 11 | 11 | 0 | 0 | **100%** |
| `group_a2153547` | 40 | 29 | 2 | 9 | **73%** |

分布不均很说明问题：`a2153547` 里引用最近会话 `8767488f` 的 10 条**全对**，引用较早的 `dde7f8c1` / `4f3e41bc` 的 14 条只对 7 条。张冠李戴的 `e298fe44` 真实存在，但属于 `dde7f8c1` 而非记录的 `4f3e41bc`。

**这笔账记不到 pi 头上**（无对照），但它触碰了项目「AI 提炼要保真」的硬约定，且 review 链路会把编造引用沉淀进记忆、污染面更大。→ 决定在开 step4 前插入 step3.5 补确定性校验。

- 实际用了多少轮：**未采集**（`onLog` 只打了工具名和 `agent_end`，没打轮次计数）。`maxTurns=30` 未触发上限。若后续要收紧这个值，得先在 `run-once.ts` 里把最终轮数打进日志。

### 给下一步的接力棒

- **`resolvePiModel(appSettings, selection, subAgentFallback, fallback) → PiModelResult`**，三个后台 handler 调用时后两参都传 `null`（三级 fallback 在 handler 侧用 `??` 链自己拼好再传第二参）
- **`runOnce(opts) → { ok: true } | { ok: false; error, cancelled? }`**，签名见上文。注意它**要 `profile`**，不只是 `model`
- **systemPrompt 身份段原文**（step4 直接复用，只改「提炼」二字对应各自任务）：
  > 你是一个后台内容提炼 agent。收到指令后，调用工具完成工作，直接使用工具裸名（不加任何前缀）。完成任务后直接结束，无需寒暄。
- **thinking**：不接。pi 用 `thinkingLevel` 而非 SDK 的 `effort`，且原 haiku 档位本来就要跳过 `effort`，不接反而消除了这个特判
- **maxTurns = 30**：依据是 `CleanTranscript` 要按脏会话数逐个调，组内会话多时轮次线性增长。冒烟测试单工具场景只用 2 轮，真实提炼的实测轮数待补
- **step4 照抄时的差异点**：
  - 三个 handler 各自的工具集不同，务必逐个核对旧 `allowedTools` 列表，用 `.filter()` 保持授权范围**不放大**（本步 group-tools 就得排掉 `WriteGroupFile`）
  - `tsconfig` 已改好，不用再动
  - 错误分支的返回结构必须保持各 handler 原样，UI 依赖它
- **插入 step3.5（保真度校验）**：本步验收测出 sources uuid 有编造，step4 之前先补上确定性校验。review 链路的 `TraceSource` 同样按 `sessionId#uuid` 回溯，step4 验收时要用同一套 uuid 索引脚本核对报告与记忆两边的引用
- **验收方法沉淀**：保真度校验的做法是「扫全库 JSONL 建 `uuid → sessionId[]` 索引，再拿组卡正文里的 `sessionId#uuid` 逐条查」，三种结果要分开计数——正确 / 张冠李戴（uuid 真实但会话记错）/ 编造（全库不存在）。合并成一个「保真率」会丢掉病因
