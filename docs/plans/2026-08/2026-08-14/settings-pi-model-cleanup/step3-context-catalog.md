---
step: 3
title: 查表扩展 + 压缩阈值百分比
status: done
---

## 目标

新建 model-catalog 模块把上下文窗口查表扩到 pi-ai 全部厂商目录；`autoCompactWindow`（token）废弃换 `autoCompactPercent`（百分比，默认 80）；usage 徽章按查表窗口 + 百分比计算进度。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-model-label.md] `piModels` 已是 `{id, label?}[]`；provider.ts 遍历对象数组
- 查表事实（已实测）：pi-ai 各厂商目录在 `node_modules/@earendil-works/pi-ai/dist/providers/*.models.js`，导出名如 `ANTHROPIC_MODELS`/`ZAI_MODELS`；同 ID 跨目录 contextWindow 取值一致；GLM（zai）/DeepSeek/Kimi（moonshotai）/MiniMax/Qwen（qwen-token-plan，托管多厂商）/Gemini（google）/Grok（xai）均有真实窗口
- import 清单（去重，见 plan 全局决策）：anthropic、openai、deepseek、zai、moonshotai、minimax、qwen-token-plan、xai、google、kimi-coding
- 现状缺口：`provider.ts:36-58` 只查 wireApi 对应的 anthropic/openai 目录，未命中回落 200_000；`services/usage/usage-extractor.ts:7-15` 的 `MODEL_CONTEXT_WINDOWS` 是手写过时表（glm-4.6 写 200K）
- 阈值语义：`阈值 = contextWindow × autoCompactPercent / 100`，默认 80%（本步只落字段与徽章，触发逻辑在 Step 4）

## 计划改动

- [x] 新建 `electron/main/agents/pi/model-catalog.ts`：
  - import 上述 10 个目录，合并为一张 `Record<string, { contextWindow: number; maxTokens?: number }>` 查表（后写覆盖先写，同 ID 值一致无碍）
  - 导出 `lookupContextWindow(modelId: string): number | undefined` 与 `FALLBACK_CONTEXT_WINDOW = 200_000`
- [x] `electron/main/agents/pi/provider.ts`：`buildPiModel` 的 `contextWindow` 改 `lookupContextWindow(modelId) ?? FALLBACK_CONTEXT_WINDOW`；`lookupCatalogModel` 中 contextWindow/maxTokens 部分改调 model-catalog（reasoning/thinkingLevelMap 保持 wireApi 官方目录查询，行为不变）
- [x] 类型双份：删 `autoCompactWindow?: number`，加 `autoCompactPercent?: number`（注释：触发比例 50–95，缺省 80）
- [x] `electron/main/services/settings-service.ts`：profile 迁移加 `delete autoCompactWindow`；`DEFAULT_SETTINGS` 同步（default profile 不必显式写 percent，缺省即 80）
- [x] `electron/main/services/usage/usage-extractor.ts`：删 `MODEL_CONTEXT_WINDOWS` 手写表，import `lookupContextWindow` 替换 :78 引用
- [x] `electron/main/agents/pi-session/usage-extractor.ts` :25 import 与 :71 `maxTokens`、`extractPiUsageEntry` 内 :146+ 两处 `MODEL_CONTEXT_WINDOWS[modelId]` 改 `lookupContextWindow(modelId) ?? 0`
- [x] `components/agent-chat/usage-badge/useConversationUsage.ts` :18-23：取 `profile.autoCompactPercent ?? 80` 传给 resolveContext
- [x] `components/agent-chat/usage-badge/usage-utils.ts` `resolveContext`（:21-44）：入参改 `(snapshot, percent)`；limit 用 snapshot 自带 contextWindow（主进程已写入查表值）；`percentage = used/limit`，超过 percent 返回接近满载状态供徽章变色提示「即将压缩」；删 autoCompactWindow 相关注释
- [x] `app/settings/page.tsx`：「自动压缩窗口」区改为「自动压缩阈值」百分比输入（50–95，默认 80）+ 换算展示（用当前 profile 第一个模型的查表窗口，如「80%（204.8K 窗口 ≈ 164K tokens 时触发）」）；模型清单每行 ID 旁显示生效窗口徽标：命中目录 → 「204.8K」、未命中 → 「200K · 未识别」；**实施决策：采用渲染层直接 import pi-ai 目录**，新建 `lib/pi-model-catalog.ts`（同源副本，tsconfig 隔离无法与主进程共享），10 个目录 json 合计约 52KB 已验证打入 bundle（Vite 支持 import attributes），未走 tipc

## 验收

- `bun run build` + `bun run lint` 通过
- settings.json 里旧 `autoCompactWindow` 字段启动后被删除
- 用 glm/kimi 系模型发消息，usage 徽章上下文窗口显示真实值（如 262K 而非 200K），百分比按新逻辑计算
- 设置页模型清单显示每模型生效窗口，未识别模型有标记

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 渲染层窗口徽标采用**直接 import pi-ai 目录**方案（step 首选项）：新建 `lib/pi-model-catalog.ts` 与主进程 `model-catalog.ts` 同源双份（tsconfig.electron rootDir=./electron 与渲染层 tsconfig exclude electron 双向隔离，无法共享单份）；10 目录 json 约 52KB 已验证打入 bundle（Vite 支持 `with { type: 'json' }` import attributes），未新增 tipc
  - `resolveContext` 的「接近满载状态」落地为 `ContextInfo.nearCompact: boolean`（percentage ≥ percent），`UsageBadge` barColor 优先消费它变红（保留 ratio>0.85 兜底），percent 与设置项同一数字
  - 顺手修复 `electron/main/services/usage/usage-extractor.test.ts` 两处历史遗留 fail（`entry.toolCalls` 改为现行 `entry.toolActivity?.calls`）
  - 同步 `docs/codebase-map.md`（usage-extractor 描述、pi/provider 描述、新增 pi/model-catalog 条目）
  - 清理 dist 内两个孤儿构建产物（usage-extractor.test.js、query-based-session.js，源码均已不存在）
- 改动文件清单：
  - 新建 `electron/main/agents/pi/model-catalog.ts`、`lib/pi-model-catalog.ts`
  - 改 `electron/main/agents/pi/provider.ts`、`types/settings.ts`、`electron/main/services/settings-types.ts`、`electron/main/services/settings-service.ts`、`electron/main/services/usage/usage-extractor.ts`（+其 test）、`electron/main/agents/pi-session/usage-extractor.ts`、`components/agent-chat/usage-badge/useConversationUsage.ts`、`usage-utils.ts`（+其 test）、`UsageBadge.tsx`、`app/settings/page.tsx`、`docs/codebase-map.md`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `model-catalog.ts`：`MODEL_CATALOG: Record<string, { contextWindow: number; maxTokens?: number }>`（113 个模型）、`lookupContextWindow(modelId): number | undefined`、`lookupCatalogEntry(modelId)`、`FALLBACK_CONTEXT_WINDOW = 200_000`
  - `ModelProfile.autoCompactPercent?: number`（50–95，缺省 80；旧 autoCompactWindow 由 migratePiProfiles 删除）
  - `resolveContext(snapshot, percent=80)` → `ContextInfo { used, limit, percentage, label, nearCompact }`
  - pi 会话快照 `extractPiContextSnapshot` 的 `maxTokens` 已是查表真实窗口（未命中 0），Step 4 触发判定建议复用同一快照/查表口径
- 下个 step 该从哪里继续：`step4-auto-compact.md`（pi-harness-adapter 暴露 compact() + pi-session 发消息前阈值触发）
- 待办或已知限制：
  - 目录未收录的模型 ID（如 glm-4.6、deepseek-chat 旧名）徽标显「200K · 未识别」，运行时 buildPiModel 回落 200K
  - 手动验收项（glm/kimi 发消息看徽章 262K、设置页徽标显示）需 `bun run dev` 实机验证
