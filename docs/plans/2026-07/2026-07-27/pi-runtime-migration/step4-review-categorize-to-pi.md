---
step: 4
title: review + categorize 切 pi，阶段一收尾
status: done
---

## 目标

把剩下三个后台 handler 照 step3 的模式切到 pi，然后清理阶段一遗留。切完后 `agent-worker.ts` 里只剩 `PARSE_ARTICLE` 和主会话链路还在用 SDK。

## 依赖上下文（接力棒输入）

**来自 step3**：`resolvePiModel` / `runOnce` 的最终签名、systemPrompt 身份段文案、`effort`/thinkingLevel 的处理方式、maxTurns 定值。开工前读 step3 的「给下一步的接力棒」。

**三个目标 handler**（结构与 `handleGroupDigestTask` 同构，改法一样）：

| handler | 位置 | mcpServers | 授权工具 |
|---|---|---|---|
| `handleReviewSessionTask` | `agent-worker.ts:~722`，query 在 `:776` | `dogear-memory-review` + `dogear-memory` | ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport / RecallMemory / SaveMemory / ForgetMemory / GetCoreProfile / UpdateCoreProfile（10 个） |
| `handleCategorizeSessionTask` | `agent-worker.ts:~835`，query 在 `:1018` | `dogear-smart-category` | ListCategories / SaveCategoryJoin / SaveCategoryNew / SaveCategoryMerge（4 个，**不给 PruneCategoryTags**） |
| `handleCategorizeOrganizeTask` | `agent-worker.ts:1155`，query 在 `:1208` | `dogear-smart-category` | ListCategories / PruneCategoryTags / SaveCategoryMerge（3 个，**不给 SaveCategoryJoin / SaveCategoryNew**） |

> ⚠️ 后两个共用同一个 `createCategoryTools()` 工厂但**授权子集不同**，切 pi 时按各自的实际列表传 defs，不要图省事全传——授权范围变化会改变模型行为。

**`handleCategorizeSessionTask` 的特殊结构**：它不是纯 LLM 任务。Step A 先跑 `matchByThreshold` 纯函数做阈值匹配（0 LLM），命中就直接 push 记 `'match'` 早退；**只有没命中才走 query**（`:1018`）。所以本步只改 `:1018` 那段 LLM 分支，Step A 的纯函数路径完全不动。另外它无 tags 时会记 skip 早退，也不动。

**`createMemoryTools(workspacePath, opts?: { autonomous?: boolean })`**：review 任务传的是 `autonomous: true`（切换 SaveMemory 的 description 文案，允许 agent 自主判断该不该写记忆）。切 defs 时这个参数必须原样透传。

## 计划改动

### 1. 三个 handler 逐个切换

对每个 handler，重复 step3 的第 3 段改法：

- [ ] `resolveModelSelection` → `resolvePiModel`（各自的三级 fallback 保持不变：review 用 `reviewModelSelection`、两个 categorize 用 `categorizeModelSelection`，都兜底到 `defaultModelSelection`）
- [ ] `createXxxTools(...)` → `createXxxToolDefs(...)`
- [ ] `query({...}) + for await` → `runOnce({...})`，`systemPrompt` 复用 step3 的身份段
- [ ] 删 `permissionMode` / `env` / `effort` / `pathToClaudeCodeExecutable` / `mcpServers` / `allowedTools`
- [ ] 按上表传各自的授权工具子集
- [ ] 返回结构、取消分支、错误分支、日志一律不动

顺序建议：`handleCategorizeOrganizeTask`（最简单，3 个工具）→ `handleCategorizeSessionTask` → `handleReviewSessionTask`（工具最多、产出最难验）。

### 1.5 工具错误的可观测性（step3.5 遗留）

step3.5 验收时发现：工具返回 `isError` 后 agent 是否自行修正、修了几轮，**在日志里完全看不到**（logger 只落盘 WARN/ERROR，`onLog` 打的是 INFO 且只有工具名）。当时靠「引用正确数不降反升」反推校验器生效，证据链是间接的。review 链路的 `TraceSource` 引用面更大，本步验收需要能直接观测。

- [ ] `run-once.ts`：工具执行失败时通过 `onLog` 打一条可识别的错误日志（含工具名 + 错误摘要），由 handler 侧以 WARN 级落盘
- [ ] 实现位置自行判断：优先看 pi 的 `tool_execution_end` 事件是否携带错误信息（step3 当时判断「无信息增量」故未订阅，现在有了）；若事件拿不到，退而在 `tool-adapter.ts` 的 `toPiTools` 翻转 `isError → throw` 那一处回调出去——**但不要在 `tool-adapter.ts` 里直接引 logger**，它是两个运行时共用的中立层，只能通过回调把错误交出去
- [ ] 错误摘要做长度截断（几百字符量级），保真度校验的错误文案会逐条列出所有问题引用，整条打进日志会淹没日志文件

### 2. 清理

- [ ] 检查 `agent-worker.ts` 顶部的 SDK 动态 import：原有 5 处 `import('@anthropic-ai/claude-agent-sdk')`，切完后应只剩 `PARSE_ARTICLE` 和主会话相关的仍在用，多余的删掉
- [ ] 确认 `buildQueryBaseConfig` 是否还被后台任务调用——如果四个 handler 都不再需要它拿 `env`，但仍需要 `appSettings`（读 `digestModelSelection` 等），保留调用但去掉无用字段的解构
- [ ] ~~`.claude/rules/codebase-map.md`~~ → **主会话负责**，子会话不要动 `.claude/` 下任何文件

### 3. 阶段一总结

- [ ] `plan.md` 末尾加「## 完成总结」：实际改动汇总、与原设计的偏差、发现的新问题
- [ ] 在设计文档 `pi-runtime-migration-design.md` 的「未决问题」一节回填结论

## 验收

- [ ] `bun run build:electron` + `bun run lint` 通过
- [ ] **首页报告**：手动触发 review，比对新旧 `dashboard.md`。重点看分流是否正确（沉淀进记忆、待办进报告），以及 `TraceSource` 有没有被真实调用（保真度）
- [ ] **智能分类**：触发一次组提炼让它链式起分类，确认 `match` / `join` / `new` 三种 outcome 都能正常落库，前端 `categoriesUpdated` 事件到达、列表刷新
- [ ] **存量整理**：手动触发一次全量重跑分类，确认 `PruneCategoryTags` 和 `SaveCategoryMerge` 正常
- [ ] 三条链路的**取消按钮**都实测一遍（`agent.abort()` 路径）
- [ ] 设置页三个 Tab 的活动状态 / 队列深度 / recent 记录都正常

## 已知风险

- **review 是最难验的**：它同时写记忆和报告两处，且「什么该进记忆、什么该进报告」全靠提示词引导。没有 `claude_code` preset 后分流质量可能漂移，比对时要同时看 `.dogear/memory/` 和 `dashboard.md` 两边。
- **categorize 的 JSON schema 严格性**：`category-tools.ts` 里三个 `Save*` 工具是**故意拆开**的，因为 GLM 等国内 Anthropic 兼容层不吃 `discriminatedUnion` 的 `oneOf` 和 tuple 的 `prefixItems`。换到 pi 后 schema 走 `z.toJSONSchema()` 产出的形状可能与 SDK 产出的不同，**要在真实的国内端点上验一遍**，别只在一个 provider 上测。

## 实施回填

### 实际改动

| 文件 | 性质 |
|---|---|
| `electron/main/agents/agent-worker.ts` | 主改，净减约 60 行：三个 handler 切 `runOnce`，删 3 处 SDK 动态 import |
| `electron/main/agents/pi/run-once.ts` | +5 行：`tool_execution_end` 错误日志 |
| `.claude/rules/codebase-map.md` / `agent-development.md` / `CLAUDE.md` | 主会话改（子会话不碰 `.claude/`） |

**与计划的差异**

1. **外层 catch 的取消分支被删掉了**（计划说「取消分支一律不动」）。理由成立：`runOnce` 不抛出，取消以 `{ ok:false, cancelled:true }` 返回，外层 catch 里的 `if (abortController.signal.aborted)` 已成死代码。删掉后外层 catch 只捕获真正的意外异常（如 `readCategoryIndex` 的 IO 错误），比旧版更严格——旧版会把恰好发生在取消期间的意外错误误报成「已取消」。
2. **`tool_execution_end` 确实带错误信息**，step3 判断的「无信息增量」是错的。事件类型是 `{ toolCallId, toolName, result, isError }`，`result` 即 `AgentToolResult`。1.5 节因此落在 `run-once.ts` 的 `subscribe` 里，不需要动中立层 `tool-adapter.ts`。
3. **验收时补了一处子会话的遗漏**：它给三个新切的 handler 加了 `[tool-error] → WARN` 分级，却漏掉 `handleGroupDigestTask`（step3 已完成，被判为「不在本步范围」）。但 1.5 节的需求正是从 step3.5 的组卡保真度校验来的，**保真度校验就跑在 GROUP_DIGEST 链路上**——漏掉它等于给三条不需要的链路加了可观测性，唯独漏掉提出需求的那条。已退回补齐，四条链路现在一致。

**授权范围核对**（逐一对照旧 `allowedTools`，无放大）：review 10 个全授权；`handleCategorizeSessionTask` filter 掉 `PruneCategoryTags` 剩 4 个；`handleCategorizeOrganizeTask` filter 掉 `SaveCategoryJoin` / `SaveCategoryNew` 剩 3 个。

`bun run build:electron` 0 error；`bun run lint` 0 error / 83 warning，与基线一致无新增。

### 三条链路的质量比对结论

> **待手测**。代码层面已切换完成，但三条链路都需要真实触发才能验产出质量，主会话无法自行触发。

- review（报告 + 记忆分流）：设置页「首页报告」Tab 触发。看 `dashboard.md` 与 `.dogear/memory/` 两边的分流是否正确、`TraceSource` 是否真实调用（日志找 `[tool] TraceSource`）、有无 `[tool-error]` WARN
- categorize（三种 outcome）：组提炼成功后链式触发，或设置页「立即重跑全部分类」。看 `recentDecisions` 里 match / join / new 三种都能落库、前端 `categoriesUpdated` 到达
- organize（合并 + 剪标签）：分类条数 > 5 后才有意义。看 `PruneCategoryTags` / `SaveCategoryMerge` 落库
- 三条链路的**取消按钮**各测一次（现在走 `runOnce → { cancelled: true }`，路径比旧版直接）
- **国内端点的 schema 兼容性**：`category-tools.ts` 三个 `Save*` 是为了绕开 GLM 不吃 `discriminatedUnion` 才故意拆开的，换 pi 后 schema 由 `z.toJSONSchema()` 产出，形状与 SDK 不同，**必须在 GLM 这类端点上验**，不能只在官方端点测

### 阶段一遗留

**还在用 SDK 的地方**
- `PARSE_ARTICLE`（`agent-worker.ts:395`）——依赖 SDK 的 plugins skill 发现机制，pi 无对应物
- 主会话 `query-based-session.ts`——阶段一明确不动

**二期该做的**
- 主会话迁移：前置条件是先解决 `plugins` skill 发现机制的替代方案
- `ModelProfile` 加 `apiFormat` 字段（`provider.ts` 已留好形状，是纯增量）
- `ModelProfile` 的 `disableNonessentialTraffic` / `autoCompactWindow` / `subagentModelTier` 在 pi 侧无用，SDK 侧退场后统一清理
- prompt cache 优化：把稳定模板移进 `systemPrompt` 段
- `handleSummarizeTask`（`agent-worker.ts:350`）是个存量 stub，带 `// TODO: 集成实际的摘要功能`。**不是本次引入的**，但违反项目「不留半成品」约定，该在某次清理里删掉或补完
