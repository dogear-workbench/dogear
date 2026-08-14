# 设置页模型管理清理 + 模型改名 + 自动压缩接入 设计

**日期**：2026-08-14

## 背景

Claude Agent SDK 主会话运行时已整体移除，所有会话统一走 PiSessionManager，但设置页仍残留「运行时格式」选择器（anthropic-sdk/pi）及其 SDK 分支编辑区，说明文案也已严重过时（声称 pi 暂不支持子会话派遣/group/reference/stock 等，实际均已实现）。同时 pi 模型清单每条「既是模型标识也是显示名」，无法改名；`disableNonessentialTraffic` 在 pi 下是零引用的死配置；`autoCompactWindow`（CLAUDE_CODE_AUTO_COMPACT_WINDOW）语义失效，pi 会话目前永远不会自动压缩。

## 目标

1. 清除 SDK 痕迹：选择器、三档模型输入、死配置、过时文案
2. pi 模型清单支持改名（显示名与模型 ID 分离）
3. 三个配置项处置：API 超时保留（已生效）；禁用非必要流量删除；自动压缩按 pi 语义重新接入

## 架构

### A. SDK 痕迹清理（方案 A：全部 profile 已 pi 化，存量数据强制迁移）

- 设置页删「运行时格式」选择器 + 说明文案；pi 编辑区（上游协议 + 模型清单）恒显示；删 Haiku/Sonnet/Opus 三输入框；删「禁用非必要流量」开关
- `migratePiProfiles`（settings-service.ts:73）改为无条件：所有 profile 视为 pi——`piModels` 为空时用 `haikuModel/sonnetModel/opusModel` 做种子（现有逻辑），并 `delete` 掉 `apiFormat`、`disableNonessentialTraffic`、`haikuModel`、`sonnetModel`、`opusModel` 字段后落盘
- `resolvePiModel`/`buildPiModels`（provider.ts）删 SDK 分支；`isProfileComplete` 只查 `piModels.length > 0`
- 渲染层 `ModelSelector.tsx` / `lib/model-selection.ts` / `app/settings/SubAgentTab.tsx` 删 `tierToModelKey` 与三档兼容分支
- 类型双份（`types/settings.ts` + `electron/main/services/settings-types.ts`）删字段与 `ModelTier` 类型；`tier` 恒为 piModels 里的模型 ID
- 存量对话若 tier 存的是 `haiku/sonnet/opus`，显示「已删除的模型」，重选一次（已接受）
- 顺带修 `pi-session.ts:693`：usage 兜底模型 ID 误用 `profile.opusModel` → 改为当前解析出的模型 ID

### B. 模型改名：`piModels: Array<{ id: string; label?: string }>`

- **对话数据零改动**：`ModelSelection.tier` 仍存模型 ID（pi 请求体 model 字段），`label` 纯显示
- 设置页每条模型行加行内改名（铅笔图标 ↔ 输入框），空值存回 `undefined`
- 显示统一 `label ?? id`：ModelSelector 下拉/当前徽章、SubAgentTab 标签、`buildPiModel` 的 `name` 字段
- normalize 迁移：加载时旧 `string[]` 逐条转 `{ id }`（去重保持首现顺序）
- 同 id 不可重复校验沿用现有 includes 逻辑（改成按 id 比较）

### C. 自动压缩接入（发消息前触发，无竞态）

关键事实（已读 pi-agent-core 源码确认）：
- `harness.compact()` 要求 idle，`prompt()` 也要求 idle → 压缩放在 `pi-session.sendMessage()` 的非 steer 分支、`prompt()` 之前，天然无 busy 竞态
- `calculateContextTokens(usage) = totalTokens || input + output + cacheRead + cacheWrite`（取自最近一条合法 assistant 消息的 usage）
- pi 默认判定 `shouldCompact`：`contextTokens > contextWindow - reserveTokens(16384)`
- compact 内部生成摘要（一次独立 LLM 调用，不走 agent 事件流）→ 写 `CompactionEntry` → emitOwn `session_compact`
- 前端全链路现成：实时 `compact_boundary` 消息（transformers.ts:135 → ContentBlockItem 渲染）、重开历史（tipc/agent.ts:411 → history-adapter.ts:67 compactionToMessage）；历史唯一来源是 session tree，实时 emit 只更新内存 UI，两路径不重复

触发流程（`pi-session.ts`）：
1. `handleAgentEvent` 的 `agent_end`：从 `event.messages` 取最后一条合法 assistant 的 usage，算出 contextTokens 存 `this.lastContextTokens`（aborted/error 消息跳过，取不到则置 undefined）
2. `sendMessage()` 非 steer 分支、`prompt()` 之前：`lastContextTokens` 超阈值时——先 emit 一条 `'compacting'` 状态消息（前端现成渲染），`await adapter.compact()`，成功后 emit `'compact_boundary'` 实时消息（带 `compactTrigger: 'auto'`、`compactPreTokens`），再 `prompt()`
3. 阈值 = `contextWindow × autoCompactPercent / 100`（百分比触发，默认 80%，不再用 pi 的固定 reserve 模型；不用 shouldCompact，自行一行比较）
4. `autoCompactWindow`（token 语义）废弃，normalize 删除旧字段；新字段 `autoCompactPercent`（50–95，默认 80）；model（含 contextWindow）在 start() 时存实例字段

### C2. 上下文窗口查表扩展

- `provider.ts` 的 `lookupCatalogModel` 查表范围从 anthropic/openai 两目录扩到 pi-ai 全部目录（zai/deepseek/moonshotai/minimax/qwen-token-plan/google/xai/kimi-coding 等，实测同 ID 跨目录取值一致，首个命中即可），国产模型不再回落盲猜 200K
- `contextWindow = 目录命中 ? 真实值 : 保守 200_000`；阈值 = `contextWindow × autoCompactPercent%`（默认 80%）。未识别模型回落 200K 基准，真实窗口更小则可能压缩晚于超窗——设置页有「未识别」标记提醒，暂不加条目级窗口覆盖（YAGNI，遇真实需求再加）
- 设置页模型清单每行显示实际生效窗口（如「204.8K · 已识别」/「200K · 未识别」）
- 顺带替换 usage 徽章的手写过时表 `MODEL_CONTEXT_WINDOWS`（`services/usage/usage-extractor.ts:7`）为同一查表来源，上下文百分比更准

### D. UI 文案

- 「自动压缩阈值」改为百分比：默认 80%，可调 50–95；显示换算结果（如「80%（200K 窗口 ≈ 163K tokens 时触发）」）。删除所有 CLAUDE_CODE_AUTO_COMPACT_WINDOW / SDK 字样
- usage 徽章进度条按 `contextTokens / contextWindow` 计算，超过触发比例变色提示「即将压缩」，与设置项同一数字

## 模块边界

| 文件 | 改动 |
|------|------|
| `app/settings/page.tsx` | 删选择器/三档输入/非必要流量开关；模型清单改对象数组 + 改名 UI；压缩阈值改百分比 |
| `types/settings.ts` / `electron/main/services/settings-types.ts` | 类型收敛（删 5 个字段 + ModelTier；piModels 改形） |
| `electron/main/services/settings-service.ts` | migratePiProfiles 无条件化 + 字段删除 + piModels 数组迁移 |
| `electron/main/agents/pi/provider.ts` | 删 SDK 分支；遍历 piModels 对象数组；name 用 label；查表扩到全部目录 |
| `electron/main/agents/pi-session/pi-session.ts` | lastContextTokens 追踪、压缩触发、compact_boundary/compacting emit、usage 兜底修正 |
| `electron/main/agents/pi-session/pi-harness-adapter.ts` | 暴露 `compact()` 转发 harness.compact() |
| `components/ModelSelector.tsx` / `lib/model-selection.ts` / `app/settings/SubAgentTab.tsx` | 删 SDK 分支；显示 label ?? id |
| `electron/main/services/usage/usage-extractor.ts` | `MODEL_CONTEXT_WINDOWS` 手写表替换为 pi 目录查表 |
| `components/agent-chat/usage-badge/useConversationUsage.ts` / `usage-utils.ts` | 改用 autoCompactPercent + 查表窗口算进度条，超比例变色 |

## 错误处理 / 边界情况

- **compact 失败**（摘要生成失败/无内容可压）：log warn + emit 一条简短提示消息，跳过压缩直接 `prompt()`（尽力而为；若上下文真超窗，模型错误会正常浮现）
- **压缩期间用户关闭会话**：close() 的 abort 链路对 compact 同样生效（compaction phase 会被 finally 置回 idle）
- **同轮内超窗**：单 turn 中途不压缩（turn 间隙触发），长 turn 极端膨胀时可能模型报超窗错误——与 SDK 时代行为一致，接受
- **compact 的摘要调用 usage**：`CompactionResult.usage` 存在但不计入会话 usage entry（不走 agent 事件流，避免复杂化；量级为一次摘要调用）
- **老对话 tier 失配**：显示「已删除的模型」，重选即恢复

## 未决问题（实施时确认）

- `adapter.compact()` 转发时是否需要透传 `customInstructions`——当前无需求，签名留空
- steer 分支不触发压缩（run 进行中，settled 后下一条消息自然触发）
