---
step: 2
title: pi-session 接入注册表
status: done
---

## 目标

会话启动的提示词拼装与工具组注册改为消费 `resolveAbilities` 同一份结果，消灭散落 if；引入规则文件/能力包开关的真实行为变化。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-registry.md] `ability-registry.ts`，关键签名 `resolveAbilities(config, opts): Set<string>`
- 当前关键文件：`electron/main/agents/pi-session/pi-session.ts:495` 起的拼装段（projectClaudeMd/userClaudeMd 读取、skill 索引、coreProfileText/groupContextText、条件段 if、buildMainAgentToolDefs/buildSubAgentToolDefs）
- 关键决策回顾：生效 = 包开关 ∩ 触发条件 ∩ Profile 过滤；协作包关闭 → 组上下文裁纯组头；子会话契约不查包；executor 会话本就跳过笔记纪律的逻辑保留

## 计划改动

- [ ] `pi-session.ts` 拼装段：
  - 开头 resolveAbilities 得 `activeAbilities`
  - 规则文件：`projectClaudeMd` 受 `workspace-rules` 包、`userClaudeMd` 受 `global-rules` 包、`coreProfileText` 受 `core-profile` 包（关 = 不读不注入）
  - 段注入：memory-guidance / notes-discipline / main-agent-delegation 改查包（保留原触发条件：主会话+workspacePath / groupId / !executor）
  - 子会话：MEMORY_GUIDANCE 改为 `activeAbilities.has('memory')`（替代 profile.enabledAbilities.memory 单独判断，Profile 过滤并入 resolveAbilities 的 opts）
  - skill 索引：skill 型包未生效 → 包内 skill 从 filteredByConfig 里剔除
- [ ] 工具组注册联动：`buildMainAgentToolDefs` / `buildSubAgentToolDefs` 里 dogear-memory / dogear-notes / dogear-delegation / dogear-group / dogear-reference 的注册条件并入包生效结果（记忆/笔记现状是主会话+工作区注册，加包开关；协作三组现状属组注册，加包开关）
- [ ] `group-context-builder.ts`：接受 `collabEnabled` 参数，false 时输出纯组头（组名一句，去掉共享区引导/话题状态指引，避免幻引不存在的工具）
- [ ] 回归：`session-append-templates.test.ts` 与 delegation 相关测试跑通；executor 会话行为不变（未拨开关时）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 主会话 dogear-memory 注册加「无工作区兜底」特判：现状该组无条件注册而 memory 包触发条件含 hasWorkspace（无工作区会话真实存在），直接查包违反零变形；写为 `!workspacePath || activeAbilities.has('memory')`
  - 子会话协作三组未并入 agent-collab 包开关（交付基础设施不能断）：包联动只作用主会话侧，自洽（关包 → 主会话无派遣 → 无新子会话；存量子会话被 resume 时交付工具完整）
  - 验收返工补齐：主会话 OPTIONAL_TOOL_PACKS 循环加包总闸 gate（设计要求「不会半开」），新增导出 `TOOL_PACK_TO_ABILITY: Map<string, string>`（skill 型包 toolGroups 数据驱动反查，Step 3 挂载反查复用）
- 改动文件清单：
  - `electron/main/agents/pi-session/pi-session.ts`（能力包解析段 + 规则文件/段注入/skill 索引/工具注册查包；buildMain/SubAgentToolDefs 加 activeAbilities 参数）
  - `electron/main/agents/ability-registry.ts`（新增 TOOL_PACK_TO_ABILITY 导出）
  - `electron/main/agents/group-context-builder.ts`（buildGroupContextPrompt 加 collabEnabled?，false 时只返回组名一句）

### 给下一步的接力棒
- 关键签名 / 数据结构：`buildGroupContextPrompt(wsId, groupId, {selfConversationId?, executor?, collabEnabled?})`；`TOOL_PACK_TO_ABILITY.get(工具包name) → 包key | undefined`（无键 = 不在包体系直通）
- 下个 step 该从哪里继续：Step 3 IPC——前端拨开关只写 `updateWorkspaceConfig({ abilityOverrides })`，**不要双写 enabledToolPacks/enabledSkills**（包总闸已在拼装侧生效，细闸保留用户细配置）；挂载反查 toolPacksOverride 复用 TOOL_PACK_TO_ABILITY
- 待办或已知限制：存量 enabledSkills/enabledToolPacks 已勾选 skill 型包内容的用户升级后受包总闸（default false）影响需拨开关恢复（计划预期行为变化）；abilityOverrides 变更的快照标脏接线未做（Step 3/4 写开关时接，rebuildForSettingsChange 可复用）
