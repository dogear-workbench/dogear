---
step: 3
title: 查表扩展 + 压缩阈值百分比
status: pending
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

- [ ] 新建 `electron/main/agents/pi/model-catalog.ts`：
  - import 上述 10 个目录，合并为一张 `Record<string, { contextWindow: number; maxTokens?: number }>` 查表（后写覆盖先写，同 ID 值一致无碍）
  - 导出 `lookupContextWindow(modelId: string): number | undefined` 与 `FALLBACK_CONTEXT_WINDOW = 200_000`
- [ ] `electron/main/agents/pi/provider.ts`：`buildPiModel` 的 `contextWindow` 改 `lookupContextWindow(modelId) ?? FALLBACK_CONTEXT_WINDOW`；`lookupCatalogModel` 中 contextWindow/maxTokens 部分改调 model-catalog（reasoning/thinkingLevelMap 保持 wireApi 官方目录查询，行为不变）
- [ ] 类型双份：删 `autoCompactWindow?: number`，加 `autoCompactPercent?: number`（注释：触发比例 50–95，缺省 80）
- [ ] `electron/main/services/settings-service.ts`：profile 迁移加 `delete autoCompactWindow`；`DEFAULT_SETTINGS` 同步（default profile 不必显式写 percent，缺省即 80）
- [ ] `electron/main/services/usage/usage-extractor.ts`：删 `MODEL_CONTEXT_WINDOWS` 手写表，import `lookupContextWindow` 替换 :78 引用
- [ ] `electron/main/agents/pi-session/usage-extractor.ts` :25 import 与 :71 `maxTokens`、`extractPiUsageEntry` 内 :146+ 两处 `MODEL_CONTEXT_WINDOWS[modelId]` 改 `lookupContextWindow(modelId) ?? 0`
- [ ] `components/agent-chat/usage-badge/useConversationUsage.ts` :18-23：取 `profile.autoCompactPercent ?? 80` 传给 resolveContext
- [ ] `components/agent-chat/usage-badge/usage-utils.ts` `resolveContext`（:21-44）：入参改 `(snapshot, percent)`；limit 用 snapshot 自带 contextWindow（主进程已写入查表值）；`percentage = used/limit`，超过 percent 返回接近满载状态供徽章变色提示「即将压缩」；删 autoCompactWindow 相关注释
- [ ] `app/settings/page.tsx`：「自动压缩窗口」区改为「自动压缩阈值」百分比输入（50–95，默认 80）+ 换算展示（用当前 profile 第一个模型的查表窗口，如「80%（204.8K 窗口 ≈ 164K tokens 时触发）」）；模型清单每行 ID 旁显示生效窗口徽标：命中目录 → 「204.8K」、未命中 → 「200K · 未识别」（查表逻辑经 tipc 已有 settings 数据流？若渲染层无法直接 import 主进程模块，则在 `types/settings.ts` 侧加不了——改为主进程 tipc 或在 `lib/` 写一份同源映射。**实施时决策**：优先复用 pi-ai 目录 import（纯数据模块无 electron 依赖，渲染层可直接 import `@earendil-works/pi-ai/providers/xxx.models`，确认打包体积可接受后采用；否则走 tipc）

## 验收

- `bun run build` + `bun run lint` 通过
- settings.json 里旧 `autoCompactWindow` 字段启动后被删除
- 用 glm/kimi 系模型发消息，usage 徽章上下文窗口显示真实值（如 262K 而非 200K），百分比按新逻辑计算
- 设置页模型清单显示每模型生效窗口，未识别模型有标记

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
