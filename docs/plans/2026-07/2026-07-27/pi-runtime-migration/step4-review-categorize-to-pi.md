---
step: 4
title: review + categorize 切 pi，阶段一收尾
status: pending
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

### 2. 清理

- [ ] 检查 `agent-worker.ts` 顶部的 SDK 动态 import：原有 5 处 `import('@anthropic-ai/claude-agent-sdk')`，切完后应只剩 `PARSE_ARTICLE` 和主会话相关的仍在用，多余的删掉
- [ ] 确认 `buildQueryBaseConfig` 是否还被后台任务调用——如果四个 handler 都不再需要它拿 `env`，但仍需要 `appSettings`（读 `digestModelSelection` 等），保留调用但去掉无用字段的解构
- [ ] `.claude/rules/codebase-map.md`：补 `electron/main/agents/pi/` 三个新文件的条目；更新「组提炼链路 / 首页报告链路 / 智能分类链路」三段说明里关于 query 的描述

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

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 三条链路的质量比对结论

- review（报告 + 记忆分流）：
- categorize（三种 outcome）：
- organize（合并 + 剪标签）：

### 阶段一遗留

- 还在用 SDK 的地方：
- 二期该做的（主会话迁移的前置条件、`apiFormat` 字段、prompt cache 优化、`ModelProfile` 无用字段清理）：
