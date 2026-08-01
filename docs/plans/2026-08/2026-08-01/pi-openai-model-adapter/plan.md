# pi 运行时接入 OpenAI 格式模型 实施计划

**目标**：pi Profile 支持选择上游协议（anthropic-messages / openai-responses），能配官方 OpenAI Base URL + Key 跑 GPT-5 系列；pi Profile 的模型选择从固定三档（haiku/sonnet/opus）改为自由添加的模型清单；`ai.effort` 推理强度接入 pi 运行时（主会话 + 四条后台任务），此前 pi 全线缺这个能力。

**设计依据**：`docs/plans/2026-08/2026-08-01/pi-openai-model-adapter-design.md`（完整架构决策、排除的选项、边界情况见此文档，本计划不重复）。

**架构思路**：`ModelProfile` 保持扁平接口，新增 `piWireApi`/`piModels` 两个可选字段，只在 `apiFormat==='pi'` 时读取；`anthropic-sdk` 分支（三档模型）完全不动。`ModelSelection.tier` 类型从 `ModelTier` 放宽为 `string`，字段名/存储结构不变——pi 分支下 `tier` 直接存模型 ID。模型能力元数据（`reasoning`/`thinkingLevelMap`/`contextWindow`/`maxTokens`）优先查 `pi-ai` 内置目录（`ANTHROPIC_MODELS`/`OPENAI_MODELS`），查不到回退现有硬编码保守值。

**涉及模块**：
- `types/settings.ts` / `electron/main/services/settings-types.ts`（数据模型镜像）
- `electron/main/agents/pi/provider.ts`（协议路由 + 目录查询 + thinkingLevel 计算）
- `electron/main/agents/pi-session/pi-session.ts` / `electron/main/agents/pi/run-once.ts` / `electron/main/agents/agent-worker.ts`（thinkingLevel 消费）
- `app/settings/page.tsx`（Profile 编辑表单）
- `lib/model-selection.ts` / `components/ModelSelector.tsx`（模型选择 UI 逻辑）
- `electron/main/services/settings-service.ts`（存量迁移）

## 步骤索引

- [x] [Step 1: 数据模型 + 存量迁移](./step1-data-model-migration.md) — `ModelProfile`/`ModelSelection` 类型改造，启动时一次性迁移旧三档字段到 `piModels`
- [x] [Step 2: provider.ts 协议路由 + 能力目录查询](./step2-provider-routing.md) — `resolvePiModel`/`buildPiModel`/`buildPiModels` 按 `piWireApi` 分支，查 pi-ai 内置目录借能力元数据，算出 `thinkingLevel`
- [ ] [Step 3: pi 运行时接入 thinkingLevel](./step3-thinking-level-wiring.md) — 主会话 + 四条后台任务消费 `resolvePiModel` 新增的 `thinkingLevel`
- [ ] [Step 4: 设置页 UI + 模型选择组件适配](./step4-settings-ui.md) — Profile 表单 pi 分支（协议下拉 + 模型清单 CRUD）、`ModelSelector`/`dedupeProfileTiers` 分支
- [ ] [Step 5: 联调验收](./step5-integration-verify.md) — 真实 OpenAI Key 跑 GPT-5 端到端 + anthropic-sdk 路径回归

## 全局决策

- **两种格式并存，不做判别联合**：`ModelProfile` 保持单一扁平接口，`apiFormat==='pi'` 时忽略 `haikuModel/sonnetModel/opusModel`（不删除，允许残留旧值），`apiFormat==='anthropic-sdk'` 时忽略 `piWireApi/piModels`。
- **`ModelSelection.tier` 类型放宽为 `string`，字段名不变**：anthropic-sdk 分支仍是三选一语义（可按需 `as ModelTier` 断言），pi 分支存模型 ID 原文。
- **目录查询兜底原则**：按 `modelId` 精确匹配 pi-ai 内置目录（`@earendil-works/pi-ai/providers/anthropic.models` 的 `ANTHROPIC_MODELS`、`.../openai.models` 的 `OPENAI_MODELS`）；查不到一律回退现有硬编码保守值（`reasoning:false, contextWindow:200_000, maxTokens:8192`），不抛错、不阻塞会话创建。
- **effort 映射**：`thinkingLevel = appSettings.ai.effort ?? 'off'`，无需转换表（`EffortLevel` 是 pi `ThinkingLevel` 的子集）。
- **两处镜像**：主进程不能直接 `import` `types/`，`types/settings.ts` 和 `electron/main/services/settings-types.ts` 的 `ModelProfile`/`ModelSelection` 改动必须同步，参照现有 `apiFormat` 字段的维护方式。
- **验证方式**：不写单测。每步验证靠 `bun run build:electron`（主进程改动）/ `bun run lint` + 手测。主进程改动后需要重新编译，Vite 热重载只对前端生效。
- **落盘文件路径**：settings.json、conversations.json 等既有 JSON 存储的字段结构变化不需要额外迁移脚本包装（`piModels`/`piWireApi` 是新增可选字段，旧数据天然兼容；`ModelSelection.tier` 只是放宽类型不改存储值）。
