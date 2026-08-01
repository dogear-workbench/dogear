---
step: 3
title: pi 运行时接入 thinkingLevel
status: done
---

## 目标

主会话（`PiSession`）和四条后台任务都把 `resolvePiModel()` 新算出的 `thinkingLevel` 传进 pi 的 `Agent`，让 `ai.effort` 全局设置真正影响 pi 运行时的推理强度（此前 pi 全线没接这个能力）。顺带收尾 Step 2 遗留的 `Model<Api>` 类型传播问题。

## 依赖上下文（接力棒输入）

- **Step 2 产出**：`resolvePiModel()` 返回值新增 `thinkingLevel: ThinkingLevel`（算法是 `appSettings.ai.effort ?? 'off'`）；`PiModelResult.model` 类型是 `Model<Api>`（不再是 `Model<'anthropic-messages'>`）；`PiModelResult.tier` 类型是 `string`。
- **`electron/main/agents/pi/run-once.ts` 现状**（全文只有 77 行）：`runOnce(opts)` 的 `opts.model: Model<'anthropic-messages'>`；`new Agent({ initialState: { systemPrompt, model, tools }, streamFn, ... })` 不含 `thinkingLevel`。
- **`electron/main/agents/pi-session/pi-session.ts` 现状**：`start()` 方法（约 114-165 行）里 `resolvePiModel(...)` 解构出 `{ model, profile, tier }`（147 行附近 `const { model, profile, tier } = resolvePiModel(...)`），然后 148-160 行 `new Agent({ initialState: { systemPrompt, model, tools }, steeringMode, streamFn, beforeToolCall })`。
- **`electron/main/agents/agent-worker.ts` 现状**：4 个任务 handler 里都是同一个模式——`let model: PiModelResult['model']; let tier: ModelTier;`（Step 1 已改成 `let tier: string;`）`let resolvedProfile: ModelProfile;` 声明在前，`try { const r = resolvePiModel(...); model = r.model; tier = r.tier; resolvedProfile = r.profile; } catch {...}` 解出来，隔几十行后 `await runOnce({ systemPrompt, prompt, tools, model, profile: resolvedProfile, signal, maxTurns, onLog })`。4 处位置：
  - GROUP_DIGEST：`resolvePiModel` 在 593 行，`runOnce` 在 679 行
  - REVIEW：`resolvePiModel` 在 743 行，`runOnce` 在 771 行
  - CATEGORIZE_ORGANIZE：`resolvePiModel` 在 847 行，`runOnce` 在 999 行
  - CATEGORIZE_SESSION：`resolvePiModel` 在 1146 行，`runOnce` 在 1182 行
  （行号以 Step 1/2 改动前为准，实施时用 Grep 重新定位，不要硬编码相信这些行号）

## 计划改动

- [ ] `electron/main/agents/pi/run-once.ts`：
  - `opts.model` 类型从 `Model<'anthropic-messages'>` 改为 `Model<Api>`（`Api` 从 `@earendil-works/pi-ai` 导入）
  - 新增可选参数 `thinkingLevel?: ThinkingLevel`（默认 `'off'`），塞进 `new Agent({ initialState: { systemPrompt, model, tools, thinkingLevel }, ... })`
- [ ] `electron/main/agents/pi-session/pi-session.ts`：
  - `resolvePiModel(...)` 解构增加 `thinkingLevel`
  - `new Agent({ initialState: {...} })` 里加 `thinkingLevel`
- [ ] `electron/main/agents/agent-worker.ts`：4 处任务 handler 都要改（用 Grep 定位 `resolvePiModel(baseConfig.appSettings` 找到 4 处调用点）：
  - 声明处加 `let thinkingLevel: ThinkingLevel;`（`ThinkingLevel` 类型从 `@earendil-works/pi-ai` 导入）
  - `try` 块里 `thinkingLevel = r.thinkingLevel;`
  - 对应的 `runOnce({...})` 调用加 `thinkingLevel,`
- [ ] 全部改完后跑 `bun run build:electron`，确认 Step 2 遗留的 `Model<'anthropic-messages'>` → `Model<Api>` 类型收紧不再报错（如果还有遗漏的类型标注点，顺手改掉，不用等到 Step 5）

## 实施回填（做完后填）

### 实际改动
- **类型来源纠偏**：文档原写"`ThinkingLevel` 从 `@earendil-works/pi-ai` 导入"不准确——pi-ai 的 `ThinkingLevel` 不含 `'off'`；实际改用 `@earendil-works/pi-agent-core` 自己的 `ThinkingLevel`（含 `'off'`，与 pi-ai 的 `ModelThinkingLevel` 结构等价），因为 `Agent`/`AgentState` 都来自这个包，语义更一致
- `electron/main/agents/pi/run-once.ts`：import 改为 `import { Agent, type ThinkingLevel } from '@earendil-works/pi-agent-core'`；`opts.model` 放宽为 `Model<Api>`（Step 2 遗留类型传播收尾）；新增 `thinkingLevel?: ThinkingLevel`（解构默认 `'off'`），塞进 `new Agent({ initialState: { ..., thinkingLevel } })`
- `electron/main/agents/pi-session/pi-session.ts`：`resolvePiModel` 解构（136 行）加 `thinkingLevel`；`new Agent({ initialState })`（约 183 行）加 `thinkingLevel`
- `electron/main/agents/agent-worker.ts`：顶部加 `import type { ThinkingLevel } from '@earendil-works/pi-agent-core'`；4 处任务 handler（GROUP_DIGEST 594/688、REVIEW_SESSION 747/783、CATEGORIZE_SESSION 854/1014、CATEGORIZE_ORGANIZE 1156/1200）都补上 `let thinkingLevel: ThinkingLevel` 声明 + `r.thinkingLevel` 赋值 + `runOnce({...thinkingLevel})` 传参
- `bun run build:electron` 0 错误（Step 2 遗留的 4 处 `Model<'anthropic-messages'>` 报错已清干净）；`bun run lint` 0 error，3 个改动文件 0 warning

### 给下一步的接力棒
- `thinkingLevel` 已全链路打通：`appSettings.ai.effort` → `resolvePiModel()` → pi `Agent.initialState.thinkingLevel`，主会话 + 四条后台任务都生效
- Step 4 的 UI 配置入口（`app/settings/page.tsx` 的 effort 选择器、Profile 表单 piWireApi/piModels 编辑）本步完全未触碰
- 存量事项（非本步引入）：REVIEW/CATEGORIZE_SESSION/CATEGORIZE_ORGANIZE 三处的 `tier` 变量目前只进 taskLogger，没对外透传，Step 4/5 如需展示可留意
