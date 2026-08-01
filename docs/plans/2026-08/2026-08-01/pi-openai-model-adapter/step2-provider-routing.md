---
step: 2
title: provider.ts 协议路由 + 能力目录查询
status: done
---

## 目标

`electron/main/agents/pi/provider.ts` 按 `profile.piWireApi` 路由到 `anthropic-messages` 或 `openai-responses` 协议；按 `modelId` 查 pi-ai 内置模型目录借能力元数据（`reasoning`/`thinkingLevelMap`/`contextWindow`/`maxTokens`），查不到回退现有硬编码值；`resolvePiModel()` 额外算出并返回 `thinkingLevel`。

## 依赖上下文（接力棒输入）

- **Step 1 产出**：`ModelProfile` 已有 `piWireApi?: 'anthropic-messages'|'openai-responses'`、`piModels?: string[]`；`isProfileComplete` 已按 apiFormat 分支校验完整性（本步可以假设传进来的 pi Profile 一定有非空 `piModels`）。
- **现状代码**（`electron/main/agents/pi/provider.ts` 全文只有 87 行，改动前建议整份重读）：
  - `buildPiModel(profile, modelId, tier)` 硬编码 `api: 'anthropic-messages'`、`reasoning: false`、`contextWindow: 200_000`、`maxTokens: 8192`
  - `resolvePiModel(appSettings, selection, subAgentFallback, fallback)` 返回 `{ model, profile, tier }`，`tier` 是 `ModelTier`（三选一）；内部用 `tierMap[target.tier]` 查 `{haikuModel,sonnetModel,opusModel}`
  - `buildPiModels(profile)` 硬编码 `anthropicMessagesApi()`，建 3 个 tier 的 Model 塞进一个 Provider
- **pi-ai 包内确认过的 API 面**（不要凭记忆重新调研，直接用）：
  - `import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'`（现有代码已有 `anthropicMessagesApi` 的同款用法，抄一份）
  - `import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models'`，`import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models'`——两者都是**扁平**的 `Record<modelId, Model<Api>>`（`flattenModelCatalog` 处理过，不是按 api 分组的嵌套结构），直接 `OPENAI_MODELS[modelId]` 取值
  - `import type { ThinkingLevel } from '@earendil-works/pi-ai'`（`export * from './types.ts'` 已导出）
  - 目录里的模型形状示例：`OPENAI_MODELS['gpt-5']` = `{ reasoning: true, thinkingLevelMap: {off:null,minimal:'minimal',low:'low',medium:'medium',high:'high',xhigh:null,max:null}, contextWindow, maxTokens, compat, ... }`；`ANTHROPIC_MODELS['claude-opus-4-7']` 同理有 `reasoning:true`/`thinkingLevelMap`
- **设计决策回顾**：查不到目录条目（自定义/第三方模型 ID，如 GLM）时，回退现有硬编码保守值，不抛错、不阻塞。`thinkingLevel = appSettings.ai.effort ?? 'off'`，直接赋值不需要转换表。

## 计划改动

- [ ] `electron/main/agents/pi/provider.ts`：
  - 新增内部辅助函数（例如 `lookupCatalogModel(wireApi, modelId): Partial<Model<Api>> | undefined`）：`wireApi==='openai-responses'` 查 `OPENAI_MODELS[modelId]`，否则查 `ANTHROPIC_MODELS[modelId]`；返回时只取 `reasoning`/`thinkingLevelMap`/`contextWindow`/`maxTokens` 几个字段（不要整个 Model 对象覆盖，`id`/`name`/`provider`/`baseUrl`/`api` 必须还是按当前 profile 构造，不能被目录里的官方值覆盖掉）
  - `buildPiModel(profile, modelId, tierOrLabel)` 改造：
    - `api` 字段按 `profile.piWireApi ?? 'anthropic-messages'` 取值
    - 调用上面的辅助函数，命中则 spread 覆盖 `reasoning`/`thinkingLevelMap`/`contextWindow`/`maxTokens`；未命中保留现有硬编码默认值
    - 返回类型从 `Model<'anthropic-messages'>` 放宽为 `Model<Api>`（`Api` 从 `@earendil-works/pi-ai` 导入）
  - `resolvePiModel()` 改造：
    - `PiModelResult.model` 类型改为 `Model<Api>`；`PiModelResult.tier` 类型从 `ModelTier` 放宽为 `string`（Step 1 已经把 `agent-worker.ts` 里接收它的 4 处 `let tier` 声明改成了 `string`，本步照应一下类型源头）；新增 `thinkingLevel: ThinkingLevel` 字段
    - 分支：`profile.apiFormat === 'pi'` 时，不走 `tierMap` 查表——校验 `target.tier` 是否在 `profile.piModels` 里（不在则抛错，错误信息类似"模型「X」不在方案「Y」的模型清单里"），是则直接用它做 `modelId` 调 `buildPiModel(profile, target.tier, target.tier)`
    - 其余分支（`apiFormat` 非 `'pi'` 或未设置）保持现有 `tierMap[target.tier as ModelTier]` 逻辑不变（`target.tier` 现在类型是 `string`，这里按需 `as ModelTier` 断言，注释说明"anthropic-sdk 路径的 tier 只会是三选一，类型收窄"）
    - 函数末尾计算 `thinkingLevel = appSettings.ai.effort ?? 'off'`，塞进返回值
  - `buildPiModels(profile)` 改造：
    - 按 `profile.piWireApi ?? 'anthropic-messages'` 选 `anthropicMessagesApi()` 或 `openAIResponsesApi()`
    - `models` 数组：`profile.apiFormat === 'pi'` 时遍历 `profile.piModels ?? []` 逐个 `buildPiModel(profile, id, id)`；否则保持现有三档 `buildPiModel(profile, profile.xxxModel, 'xxx')` 三次调用
- [ ] 确认 `run-once.ts`（`Model<'anthropic-messages'>` 参数类型）和调用 `resolvePiModel`/`buildPiModels` 的其余位置（`pi-session.ts`）的类型标注同步放宽为 `Model<Api>`，否则本步会导致 TS 编译错误——这部分收尾工作留到 Step 3（那一步本来就要碰这几个文件），本步先跑一次 `bun run build:electron` 确认哪些位置报错、记下清单即可，不用在本步修完

## 实施回填（做完后填）

### 实际改动
- `electron/main/agents/pi/provider.ts`（87→130行）：
  - 新增 `resolveWireApi(profile)` — `profile.piWireApi ?? 'anthropic-messages'`，三处复用
  - 新增 `lookupCatalogModel(wireApi, modelId)` — 按 wireApi 选 `OPENAI_MODELS`/`ANTHROPIC_MODELS`（断言 `Record<string, Model<Api>>` 解决字面量联合键索引报错），只取 `reasoning/thinkingLevelMap/contextWindow/maxTokens` 四个字段，查不到返回 undefined
  - `buildPiModel` 返回类型放宽为 `Model<Api>`，`api` 走 `resolveWireApi`，目录命中的字段 spread 覆盖，未命中保留硬编码默认值（`reasoning:false/contextWindow:200_000/maxTokens:8192`）；`id/name/provider/baseUrl` 始终按 profile 构造不被目录覆盖
  - `resolvePiModel`：`PiModelResult.model: Model<Api>`、`tier: string`、新增 `thinkingLevel: ModelThinkingLevel`（见下方类型偏差说明）；`apiFormat==='pi'` 分支校验 `target.tier ∈ profile.piModels` 否则抛错，通过则直接用 `target.tier` 做 modelId；其余分支保留原 `tierMap[target.tier as ModelTier]` 逻辑
  - `buildPiModels`：`api` 按 `resolveWireApi` 选 `openAIResponsesApi()`/`anthropicMessagesApi()`；`apiFormat==='pi'` 时遍历 `profile.piModels` 逐个建模，否则保留旧三档
- **类型偏差（已仲裁通过）**：`thinkingLevel` 字段类型用 `ModelThinkingLevel`（=`'off'|ThinkingLevel`）而非 step 文档写的 `ThinkingLevel`——因为 `ThinkingLevel` 不含 `'off'`，用它会违反全局决策"`effort ?? 'off'` 无需转换表直接赋值"的设计意图。已核实 pi-ai `types.d.ts:22-23` 确认此判断正确。
- `bun run lint` 通过（0 error，provider.ts 自身 0 warning）

### 给下一步的接力棒
- `bun run build:electron` 现有 4 处**预期报错**，全部指向 Step 3 范围：
  - `electron/main/agents/pi/run-once.ts:15` 的 `model: Model<'anthropic-messages'>` 需放宽为 `Model<Api>`（根因）
  - `electron/main/agents/agent-worker.ts` 4 处调用点（683/775/1003/1186，分别对应 GROUP_DIGEST_SESSION / REVIEW_SESSION / CATEGORIZE_SESSION / CATEGORIZE_ORGANIZE）会在 run-once.ts 类型放宽后自然通过，无需单独改
  - `pi-session/pi-session.ts` 消费 `resolvePiModel` 返回值处也需要确认类型标注同步放宽
- `resolvePiModel` 新增的 `thinkingLevel: ModelThinkingLevel` 字段还没被任何调用方消费，Step 3 要在 `run-once.ts`/`pi-session.ts`/`agent-worker.ts` 里接上：`thinkingLevel==='off'` 时不传 reasoning，否则 `reasoning = thinkingLevel`（此时已是合法 `ThinkingLevel` 子集）
