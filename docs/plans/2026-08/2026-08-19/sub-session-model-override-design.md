# 子会话派遣支持显式指定模型 设计

**背景**：子会话派遣（dogear__CreateSession / CreateSessionBatch）此前无法在 agent 侧显式指定模型，只能依赖 Profile → 主会话模型 → 全局默认的回退链；设置页「子会话模型」的描述文案与实际回退逻辑不符（写成了「回退到上级 AI 行为的默认模型」）。

**目标**：
1. 派遣工具加可选参数 `model`（模型 ID 单字符串），agent 可显式指定子会话用哪个模型。
2. 修正设置页文案，使其与实际回退逻辑一致。

**架构**：
- `model` 参数采用单字符串（模型 ID / tier），在所有 `isProfileComplete` 的 `ModelProfile.piModels` 里解析出 `{ profileId, tier }`（方案 A）；排除 `{ profileId, tier }` 对象方案——agent 需预知 profileId，填错率高。
- 新优先级：`spec.model` > `profile.modelSelection` > 主会话模型（`parent.modelSelection`）> 全局默认。
- 解析失败直接 throw，错误消息带可用模型 ID 清单 → 工具层转 `isError` 返回，agent 下一轮自纠。

**模块边界**：
- `electron/main/types.ts`：`DelegateSpec` 加 `model?: string`
- `electron/main/agents/delegation-bridge.ts`：新增 `resolveModelByTier`；`startChild` 模型解析链加 `spec.model` 分支
- `electron/main/agents/tools/delegation-tools.ts`：CreateSession / CreateSessionBatch schema 加 `model` 参数并透传
- `app/settings/SubAgentTab.tsx`：模型描述文案修正

**数据流**：agent 调 CreateSession(model) → spec.model → resolveModelByTier 遍历 settings.profiles → { profileId, tier } → conversationService.create(modelSel) → 子会话 PiSession 用该模型。

**错误处理**：模型 ID 解析不到时在创建 conversation 之前 throw（不留半成品）；同一模型存在于多个 profile 时取第一个匹配的完整 profile。

**不受影响**：failover 降级链（基于 modelTried，spec.model 命中组合自动记录为第一项）、resumeChild、ContractMetadata。

**未决问题**：无。
