---
step: 6
title: Profile 与能力页瘦身 + 文档同步
status: done
---

## 目标

SubAgentTab 删 memory 勾选与 stock skill 细选；能力页删开关状态残留、挂载矩阵 Profile 行加「子会话」标签；codebase-map 同步；plan 收尾。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] sub 角色 memory 已不受 Profile 闸（解析侧就位）；[step4] 场景页 sub 行已承担 memory 展示
- 当前关键文件状态：
  - `app/settings/SubAgentTab.tsx` — ProfileEditor 能力域：`SINGLE_FIELD_BY_PACK`（memory/article/web-mcp 单开关）、stock/browser/code-workflow 块、`skillCheckItems`/`packDetailCount`、自定义 Skill 块、`countAbilityDomains`
  - `app/settings/subagent/AbilityBlockRow.tsx` — AbilityBlockRow/SkillCheckItem/ChannelSwitchItem
  - `app/settings/ability/AbilityPackCard.tsx` — 「已关闭」徽章
  - `app/settings/ability/AbilityPackSidebar.tsx` — 「默认开启/关闭」徽章、AGENT_COLLAB_OFF_NOTE、底部「启停配置在场景页调整」提示
  - `app/settings/ability/AbilityMountsSection.tsx` — SceneRow 徽标逻辑（`kind === 'scheduler' ? '后台任务' : '系统预设'`）
- 关键决策回顾：memory 归场景（Profile 删块）；stock 删 skill 细选直通；browser 双通道与 code-workflow 6 skill 细选保留；`enabledAbilities.memory` 类型字段保留（数据兼容）仅停用

## 计划改动

- [ ] `SubAgentTab.tsx`：
  - 删 memory 单开关块（`SINGLE_FIELD_BY_PACK` 移除 memory 键）；能力域说明文案更新（memory 归场景页子会话行）
  - stock 块：`detailCount`/`details` 移除（开关直通包内全部 skill 与工具包），保留开关
  - `countAbilityDomains` 相应调整（memory 不再计入）
- [ ] `AbilityPackCard.tsx`：删「已关闭」徽章（enabled prop 与调用点清理）
- [ ] `AbilityPackSidebar.tsx`：删「默认开启/关闭」徽章、AGENT_COLLAB_OFF_NOTE、底部重复提示句
- [ ] `AbilityMountsSection.tsx`：`kind === 'sub-default' || kind === 'profile'` 行加「子会话」标签（与现有「后台任务/系统预设」并列位置）
- [ ] doc-sync：更新 `docs/codebase-map/settings.md`（场景页 v2、SubAgentTab 瘦身、能力页只读残留清理）与 `agent-core.md`（sceneOverrides 装配语义、execProfile、skillsOverride）
- [ ] 本 plan.md 补「完成总结」；`bun run lint` + 双端 build 全绿收尾

## 实施回填（做完后填）

### 实际改动
- 与计划差异：memory 块删除方式除从 SINGLE_FIELD_BY_PACK 移除外，同时加入 NON_PROFILE_PACK_KEYS（语义显式，不走 if(!field) return null 静默路径）；plan.md 完成总结由主会话回填
- 改动文件清单：
  - app/settings/SubAgentTab.tsx：memory 移入 NON_PROFILE_PACK_KEYS + SINGLE_FIELD_BY_PACK 删键；stock 块删细选（纯单开关直通）；countAbilityDomains 删 memory；能力域说明文案补「记忆等固定层能力归场景页子会话行」
  - app/settings/AbilityTab.tsx：AbilityPackCard 调用点删 enabled prop
  - app/settings/ability/AbilityPackCard.tsx：删 enabled prop、「已关闭」徽章
  - app/settings/ability/AbilityPackSidebar.tsx：删「默认开启/关闭」徽章、AGENT_COLLAB_OFF_NOTE、底部重复提示句
  - app/settings/ability/AbilityMountsSection.tsx：SceneRow 徽标三分支（后台任务/子会话/系统预设），profile 行显示条件放宽
  - docs/codebase-map/settings.md + agent-core.md：场景页 v2 / SubAgentTab 瘦身 / sceneOverrides 装配 / execProfile / skillsOverride 同步
- 验证：build:electron / build:renderer / lint 0 error（70 存量 warning）/ bun test 383 pass 0 fail

### 给下一步的接力棒
- 关键签名 / 数据结构：无新签名；`enabledAbilities.memory` 类型字段保留但 UI 与解析均无消费方
- 待办或已知限制：视觉目验清单见共享区 20261001-step6-delivery.md（Profile 编辑器/存量数据兼容/能力页残留清理/挂载矩阵双标签/回归 5 项）
