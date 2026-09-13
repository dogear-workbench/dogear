---
step: 4
title: 前端能力页
status: done
---

## 目标
设置页可见可配：Profile 编辑器出「联网搜索」能力域勾选框；能力页包总开关打开时自动补齐细闸。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-types-registry.md] `enabledAbilities.web` 主进程类型已落地（本步补渲染层镜像）
- 当前关键文件状态：
  - `types/settings.ts:91` 渲染层 `SubAgentEnabledAbilities` 镜像（现有 browser/extension 等键）
  - `app/settings/SubAgentTab.tsx:79-88` `BOOLEAN_ABILITIES` 硬编码列表（key 联合类型 `'memory' | 'stock' | 'article' | 'browser' | 'extension'`）；`:57-67` `countAbilityDomains`
  - `app/settings/AbilityTab.tsx:88-107` `handleTogglePack`——现有分支：无 skill 包（skillMetas.length===0 且 linkedPacks>0）开关联动 enabledToolPacks（开加关删），其余只写 abilityOverrides
- 关键决策回顾：总开关联动「enable=true 只补不删，enable=false 只关总闸」；trade-off（先关细闸再开关总闸会重新带上细闸）已接受；存量半开状态不迁移

## 计划改动
- [x] `types/settings.ts` — 镜像 `SubAgentEnabledAbilities` 加 `web?: boolean`
- [x] `app/settings/SubAgentTab.tsx` — BOOLEAN_ABILITIES key 联合类型加 `'web'`、列表加 `{ key: 'web', label: '联网搜索', desc: 'bigmodel__webSearch / bigmodel__webReader（GLM MCP 快档，API 直出）' }`；countAbilityDomains 加 `if (ab.web) n++`
- [x] `app/settings/AbilityTab.tsx` — handleTogglePack 加有 skill 包分支：enable=true 时把包内全部 `skillMetas[].name` 并入 enabledSkills、`toolGroupMetas` 中有 pack 归属的 `id` 并入 enabledToolPacks（只补不删），与 overrides 一起 persistConfig；enable=false 维持现状（只写 overrides）；无 skill 包现有逻辑不动

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。两处微调：① 渲染层镜像 `web?: boolean` 按主进程 settings-types.ts 实际顺序放在接口末尾（extension 之后）；② handleTogglePack 重构为先取 pack、再三分支（无 skill 有 linkedPacks → 现有开加关删；有 skill 且 enable → 只补不删写入 enabledSkills+enabledToolPacks；其余 → 只写 overrides），无 skill 包现有逻辑与 rules 包（无 skill 无 linkedPacks）行为均不变；useCallback 依赖数组补 workspaceConfig.enabledSkills
- 改动文件清单：
  - `types/settings.ts:97` — SubAgentEnabledAbilities 加 `web?: boolean`
  - `app/settings/SubAgentTab.tsx:64` countAbilityDomains 加 `if (ab.web) n++`；`:80` key 联合类型加 `'web'`；`:87` 列表加联网搜索项（插在 browser 之前）
  - `app/settings/AbilityTab.tsx:88-124` — handleTogglePack 加有 skill 包开总闸补齐细闸分支

### 给下一步的接力棒
- 关键签名 / 数据结构：AbilityPackView.skillMetas[].name / toolGroupMetas[].pack?/.id（electron/main/tipc/ability.ts:43-68）；开总闸补齐用包内全部 linkedPacks（非 skillToPacks 映射），与设计文档第四节一致
- 下个 step 该从哪里继续：step 文档验证段的手动验收项（Profile 编辑器出联网搜索勾选框且 default/browser-parse 默认勾）
- 待办或已知限制：无；trade-off（先关细闸再开关总闸会重新带上细闸）已按拍板接受，未做规避
