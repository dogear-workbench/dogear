---
step: 4
title: 能力页两级重构
status: pending
---

## 目标

AbilityTab 改两级结构：首页能力包卡片网格 + 详情页左右分栏（含挂载情况与规则文件编辑），删除旧硬编码组件。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-ipc.md] `getAbilityPacks()` / `getAbilityMounts(key)` / agent.md 读写 RPC 可用
- 现状参考：`app/settings/AbilityTab.tsx`（单页编排，expandedDomains/expandedPacks state、applySkillToggles 开关逻辑——skill 联动工具包的逻辑保留复用）；`app/data-center/scheduler/TaskEditorPage.tsx`（二级页形态参考：面包屑工具栏 + 左主区 + 右参数栏）；`app/settings/ability-types.ts`（本步删硬编码，保留或改写纯 UI 类型）

## 计划改动

- [ ] `AbilityTab.tsx` 改两级 state：`selectedPack: string | null`（null = 列表态）；顶部工作区选择器保留
- [ ] 新建 `app/settings/ability/AbilityPackCard.tsx`：图标 + 名称 + 描述 + 开关 + 统计（段/工具组/skill 数）+ 类型徽标；「系统行为」卡（只读无开关，type 徽标「系统」）
- [ ] 新建 `app/settings/ability/AbilityPackDetailPage.tsx`：
  - 面包屑（能力 / 包名）+ 返回
  - 左主区：说明 + 大提示词区（段型多段拼接只读展示；规则文件型内嵌 textarea 编辑 agent.md，保存走读写 RPC；core-profile 只读全文 + 跳数据中心入口）
  - 右参数栏（w-80）：主开关（写 abilityOverrides）+ 配套清单（skill 细开关走 enabledSkills 并保留 applySkillToggles 的包联动、工具组折叠列表、段列表）+ 挂载情况（getAbilityMounts，计数 + 折叠明细）+ 重启生效提示
- [ ] 「系统行为」详情页：三个结构性段全文（只读，复用段模板展示）
- [ ] 删除：`AbilityResidentSection.tsx`、`AbilityDomainCard.tsx`、`SegmentDetailDialog.tsx`；`ability-types.ts` 清掉 ABILITY_DOMAINS/SKILL_PACK_MAP/RESIDENT_GROUPS（skill→包联动逻辑若仍需前端做，映射改从 getAbilityPacks 数据派生）
- [ ] `SkillDetailDialog` / `ToolDetailDialog` 在详情页内复用保留
- [ ] 验证：`bun run dev:renderer` 手动过：卡片渲染、开关写入、详情两级切换、规则文件编辑保存、挂载情况展示

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
