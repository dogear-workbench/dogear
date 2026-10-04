---
step: 2
title: 前端开关与展示跟进
status: pending
---

## 目标

场景页、子会话派遣页、能力页跟进三个新包：开关行扩展、双开关拆分、三卡展示。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-pack-split.md] 的实施回填（三包 key 与 resolveAbilities 实际输出形态）
- 关键现状：
  - 场景页 `app/settings/scene/SceneTab.tsx`：七行 matrix（数据源 `getSceneOverview()`），browser 目前一行；sceneOverrides 键随包 key 扩展
  - 派遣页 `app/settings/SubAgentTab.tsx`：browser 单开关「齐开齐关 browser+extension 双字段」（settings.md 已注明）；browser-exploration skill 细选在能力域块内
  - 能力页 `app/settings/AbilityTab.tsx` + `ability/*`：包卡与详情页从 `getAbilityPacks()` 渲染（前端零硬编码），新包自动出卡；需关注纯 skill 包（无 toolGroups）在 `AbilityPackSidebar` / `AbilityMountsSection` 的展示是否自然
  - `tipc/ability.ts`：getAbilityPacks 视图按包聚合 toolGroups，browser-methodology 无组时的空态
- 关键决策回顾：拆开后 browser 一行变三行（内嵌 / 扩展 / 方法论）；派遣页双开关各自独立写 enabledAbilities.browser / .extension，不再齐开齐关。

## 计划改动

- [ ] `SceneTab.tsx` / `scene/` 相关：matrix 行按新包扩展（getSceneOverview 后端侧如有包清单枚举需同步——实施时以 step1 回填为准），三态渲染（switchable/forced/excluded）复用
- [ ] `SubAgentTab.tsx`：browser 能力域块拆「内嵌浏览器 / 浏览器扩展」两个开关 + 「浏览器方法论」skill 开关（写 enabledSkills 或对应字段，实施时对齐 step1 的字段语义）
- [ ] `AbilityTab.tsx` / `AbilityPackSidebar.tsx` / `AbilityMountsSection.tsx`：验证三卡自然渲染；纯 skill 包详情页（无工具组区）形态检查，必要时空态文案
- [ ] 验证：dev 人工核对——场景页三行开关写回生效（关扩展后子会话派遣页双闸反映）、能力页三卡与挂载矩阵正确、纯 skill 包详情不空白不报错

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
