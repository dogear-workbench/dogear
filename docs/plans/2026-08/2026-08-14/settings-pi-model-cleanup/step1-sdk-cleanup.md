---
step: 1
title: SDK 痕迹清理
status: done
---

## 目标

删除设置页「运行时格式」选择器、三档模型输入、非必要流量开关及全部相关类型/迁移/消费分支，存量 profile 无条件 pi 化。

## 依赖上下文（接力棒输入）

- 设计依据：[../settings-pi-model-cleanup-design.md](../settings-pi-model-cleanup-design.md) A 节
- 背景：所有会话已统一走 PiSessionManager（`electron/main/agents/pi-session/pi-session-manager.ts:1` 注释），`apiFormat` 不再决定运行时路由
- 本步**不动** `autoCompactWindow`（usage 徽章仍在用，Step 3 处理）；**不动** `piModels` 形状（Step 2 处理）
- `piModelDrafts` state（page.tsx:77）与 pi 编辑区交互保留，仅去掉外层条件

## 计划改动

- [x] `app/settings/page.tsx`
  - :480-499 删「运行时格式」选择器及过时说明文案（声称 pi 暂不支持子会话派遣/group/stock 等，均已实现）
  - :501 去掉 `{profile.apiFormat === 'pi' && (` 条件，上游协议/模型清单编辑区恒显示
  - :590-610 删 `apiFormat !== 'pi'` 的 Haiku/Sonnet/Opus 三输入框整块
  - :616-633 删「禁用非必要流量」开关整块
  - :156-159 `addNewProfile` 的新 profile 删 `haikuModel/sonnetModel/opusModel/disableNonessentialTraffic` 种子，补 `piWireApi: 'anthropic-messages'`
- [x] `types/settings.ts`：删 :15-17 三档字段、:20 `disableNonessentialTraffic`、:24-25 `apiFormat` 及注释；`isProfileComplete`（:36-39）只查 `piModels.length > 0`；`createDefaultProfile`（:154-159）同步删字段；:1 删 `ModelTier` 类型
- [x] `electron/main/services/settings-types.ts`：同步删 :23-25 三档字段、:27 `disableNonessentialTraffic`、:30-31 `apiFormat`；`DEFAULT_SETTINGS.profiles.default`（:134-141）删对应字段；`isProfileComplete`（:153-160）只查 piModels；:10 删 `ModelTier`
- [x] `electron/main/services/settings-service.ts` :73-87 `migratePiProfiles` 改为无条件：
  - 所有 profile：`piModels` 非数组或为空时用 `[haikuModel, sonnetModel, opusModel]` 过滤空值去重填入（现有种子逻辑）
  - 然后 `delete` 每个 profile 的 `apiFormat`、`haikuModel`、`sonnetModel`、`opusModel`、`disableNonessentialTraffic`
  - 有任一删除/填充发生即返回 true 落盘
- [x] `electron/main/agents/pi/provider.ts`：删 :83-90 SDK tierMap 分支（`resolvePiModel` 只走 piModels 路径）；`buildPiModels`（:106-111）删三档数组分支；:12 删 `ModelTier` import
- [x] `components/ModelSelector.tsx`：删 :25-26 `tierToModelKey`；`resolveCurrentLabel`（:31-35）删 SDK 分支，只走 `piModels.includes`
- [x] `lib/model-selection.ts`：`dedupeProfileTiers`（:6-21）删 SDK 分支与 `TIER_PRIORITY`，只遍历 piModels
- [x] `app/settings/SubAgentTab.tsx` :50-56：删 `apiFormat` 判断与 `tierKey` 兼容分支，只走 piModels includes
- [x] `electron/main/agents/pi-session/pi-session.ts` :693：usage 兜底模型 ID `this.currentResolvedProfile?.opusModel` → 用 `resolvePiModel` 结果（start() 时已解出 `tier`，需存实例字段如 `this.currentModelId` 供此处使用）
- [x] `electron/main/agents/pi-session/pi-session-manager.ts` :5-8：更新文件头注释（apiFormat 字段已删除）
- [x] 检查 `electron/main/services/settings-normalize.test.ts` 及其他引用上述字段的测试/调用点，同步修正

## 验收

- `bun run build` + `bun run lint` 通过（渲染层无 `apiFormat`/三档/`disableNonessentialTraffic` 编译错误）
- `bun run dev` 打开设置页：无运行时格式选择器、无三档输入、无非必要流量开关；pi 编辑区恒显示
- 构造含 `apiFormat: 'anthropic-sdk'` + 三档模型名的 settings.json，启动后该 profile 的 `piModels` 被三档种子填充，旧字段全部消失（检查 settings.json 落盘）
- 已有 pi 会话正常发消息（usage 徽章显示模型名不再是 undefined）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `migratePiProfiles` 种子填充加了「种子全空且 piModels 已是合法空数组时不写入」判断：避免无模型的空 profile 每次启动都无意义落盘；piModels 非数组（损坏）时仍无条件修复为 `[]`
  - pi-session.ts 未保留 `currentResolvedProfile`：该字段唯一读取点就是 usage 兜底，改存 `currentModelId` 后成为 write-only 死代码，连同 `ModelProfile` import 一并删除
  - provider.ts 顺手把报错文案「缺 API Key / Base URL / 模型映射」改为「模型清单」（原文案指代已删的三档模型映射）
  - settings-normalize.test.ts 经检查不引用本步删除的字段（其 `subagentModelTier` 是 ai 层另一批 stale 字段清理），无需修正
- 改动文件清单：见 settings-cleanup-step1-delivery.md（10 个文件）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `ModelProfile` 现仅含 `id/name/apiKey/baseUrl/apiTimeoutMs/autoCompactWindow?/piWireApi?/piModels?: string[]`；`isProfileComplete` = apiKey && baseUrl && piModels.length > 0
  - `resolvePiModel(appSettings, selection, subAgentFallback, fallback)` 返回 `{ model, profile, tier, thinkingLevel }`，只走 piModels 路径（tier === modelId）
  - 迁移已生效：所有 profile 无条件 pi 化，旧字段在首次 loadSettings 时被删除并落盘
- 下个 step 该从哪里继续：Step 2（模型改名）——piModels 从 `string[]` 改 `Array<{ id, label? }>`，两份类型文件同步改，显示链统一 `label ?? id`
- 待办或已知限制：
  - docs/codebase-map.md 中 ModelTier/apiFormat 描述已过时（本步不动文档，可收尾时统一刷新）
  - agent-worker.ts 两处注释里的 reviewModelTier/categorizeModelTier 字样是历史命名描述，非类型引用，未动
