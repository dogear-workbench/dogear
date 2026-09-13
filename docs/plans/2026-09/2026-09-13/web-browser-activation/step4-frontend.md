---
step: 4
title: 前端能力页
status: pending
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
- [ ] `types/settings.ts` — 镜像 `SubAgentEnabledAbilities` 加 `web?: boolean`
- [ ] `app/settings/SubAgentTab.tsx` — BOOLEAN_ABILITIES key 联合类型加 `'web'`、列表加 `{ key: 'web', label: '联网搜索', desc: 'bigmodel__webSearch / bigmodel__webReader（GLM MCP 快档，API 直出）' }`；countAbilityDomains 加 `if (ab.web) n++`
- [ ] `app/settings/AbilityTab.tsx` — handleTogglePack 加有 skill 包分支：enable=true 时把包内全部 `skillMetas[].name` 并入 enabledSkills、`toolGroupMetas` 中有 pack 归属的 `id` 并入 enabledToolPacks（只补不删），与 overrides 一起 persistConfig；enable=false 维持现状（只写 overrides）；无 skill 包现有逻辑不动

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
