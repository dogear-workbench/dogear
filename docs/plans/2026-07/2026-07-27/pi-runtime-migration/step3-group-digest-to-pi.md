---
step: 3
title: GROUP_DIGEST 切 pi
status: pending
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
): { model: Model; profile: ModelProfile; tier: ModelTier };
```

- [ ] 三级 fallback 与「方案不存在 / 配置不完整即抛错」的校验逻辑，与 `agent-query-config.ts:136` `resolveModelSelection` 保持一致（可提取共用，也可平行实现——**不要改动 `resolveModelSelection` 本身**，主会话还在用）
- [ ] `createProvider({ id: profile.id, name: profile.name, baseUrl: profile.baseUrl, auth: {...profile.apiKey}, models: [三个 tier], api: anthropicMessagesApi() })`
- [ ] 预留 `apiFormat` 分支的形状（缺省 anthropic），但**本步不加 `ModelProfile` 字段**
- [ ] `disableNonessentialTraffic` / `autoCompactWindow` / `subagentModelTier` 在此处显式忽略并加一行注释说明原因（迁移完毕后统一清理）

### 2. 新建 `electron/main/agents/pi/run-once.ts`

```ts
export async function runOnce(opts: {
  systemPrompt?: string;
  prompt: string;
  tools: ToolDef[];
  model: Model;
  signal?: AbortSignal;
  maxTurns?: number;
  timeoutMs?: number;
  onLog?: (msg: string) => void;
}): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }>;
```

- [ ] 内部建 `Agent`（`initialState: { systemPrompt, model, tools: toPiTools(opts.tools) }`，`streamFn: models.streamSimple.bind(models)`）
- [ ] `agent.subscribe()` 把 `tool_execution_start` / `tool_execution_end` / `agent_end` 转成 `onLog`，替代现在 `for await` 里那句 `message.type === 'result'` 的日志
- [ ] **轮次上限**（必做，step1 已定方案）：超限时 `agent.abort()` 并返回 `{ ok: false, error: '超过最大轮次 N' }`
- [ ] `opts.signal` 上挂 `agent.abort()`，区分「主动取消」与「真实错误」，对应现有 `abortController.signal.aborted` 的判定
- [ ] `timeoutMs` 用 `AbortSignal.timeout()`（承接 `profile.apiTimeoutMs`）

### 3. 改造 `handleGroupDigestTask`

- [ ] 第 2 段：`resolveModelSelection` → `resolvePiModel`，`env` 不再需要；`tier` 仍要（返回值里带、日志里打）。失败分支的返回结构不变
- [ ] 第 3 段：`createGroupDigestTools(...)` → `createGroupDigestToolDefs(...)`，其余两个同理；`saved` / `backgroundSaved` 回调透传方式不变
- [ ] 第 4 段整段替换：
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
- [ ] 删掉 `permissionMode` / `env` / `effort` / `pathToClaudeCodeExecutable` / `mcpServers` / `allowedTools` 六项
- [ ] `effort` 的处理：pi 用 `thinkingLevel`（`'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`）而非 SDK 的 `effort`。后台提炼任务默认档位低，**本步先不接 thinking，保持最简**；若产出质量下降再补，并在回填里记录

### 4. systemPrompt 身份段（必做补偿）

- [ ] 现在整份模板是当 user prompt 发的（`query({ prompt })`），`systemPrompt` 为空。**本步保持这个等价性**——模板仍走 `prompt`，`systemPrompt` 只放一小段最小身份说明（说明它是个能调工具的后台整理 agent、工具用裸名、完成后直接结束不要寒暄）
- [ ] 「模板挪进 systemPrompt 吃 prompt cache」是**二期优化**，本步不做，避免同时改两个变量

## 验收

- [ ] `bun run build:electron` + `bun run lint` 通过
- [ ] 挑一个真实的脏组，切换前先跑一次旧引擎存下组卡，切换后对同一组触发重新提炼，**逐字比对两份 `digest.md`**：概述质量、items 的 kind 分类是否合理、sources 回溯的 `sessionId#uuid` 是否真实存在（不能是编造的）、keyOutputs 路径是否真实
- [ ] `background.md` 四字段（topic / progress / keyDecisions / openQuestions）正常产出
- [ ] 设置页「会话摘要」Tab 的活动状态、进度、**停止按钮**都正常（取消路径走的是 `agent.abort()`，必须实测）
- [ ] 故意配一个错误的 profile（比如清空 apiKey），确认错误分支返回结构不变、UI 显示正常

## 已知风险

- **保真度回归**：`sources` 里的 `sessionId#uuid` 必须来自真实逐字稿。没有 `claude_code` preset 后模型编造的倾向可能上升，这是比对时的**第一检查项**（对应记忆里的「AI 提炼要保真」约定）。
- **轮次上限误伤**：组内会话多时 `CleanTranscript` 要调很多次，上限设太小会截断提炼。先设宽松（30），观察实际用了几轮再收。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 组卡质量比对结论

- 新旧差异：
- 保真度（sources 是否真实）：
- 实际用了多少轮：

### 给下一步的接力棒

- `resolvePiModel` / `runOnce` 的最终签名：
- systemPrompt 身份段的实际文案（step4 三个 handler 复用）：
- `effort` / thinkingLevel 最终怎么处理：
- maxTurns 定值与依据：
- step4 照抄时需要注意的差异点：
