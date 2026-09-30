---
step: 3
title: 能力页只读化 + 三大类分组
status: done
---

## 目标

能力页撤掉全部装配开关、按三大类分组展示；开关写回逻辑提取到共享模块供场景页复用；规则文本编辑器保留。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2] `AbilityPack.category` 与 `ABILITY_CATEGORIES` 已就绪，`getAbilityPacks` 返回的 AbilityPackView 天然携带分类
- 关键现状：`app/settings/AbilityTab.tsx` 的 `handleTogglePack`（约 113 行，总开关联动算法）与 `handleToggleSkills`（约 155 行，子开关去重算法）是要提取复用的核心资产；`persistConfig`（约 88 行，乐观更新+失败回滚）同样提取
- 边界回顾：agent.md 编辑器是内容编辑，保留在 RulesPackDetailPage；能力页卡片/详情不再出现任何装配开关

## 计划改动

- [x] 新建 `app/settings/ability/config-mutations.ts`
- [x] `app/settings/AbilityTab.tsx`：按三大类分组渲染 + 写函数撤除（改用共享模块）
- [x] `app/settings/ability/AbilityPackCard.tsx`
- [x] `app/settings/ability/RulesPackCard.tsx`（本就无开关，文案微调）
- [x] `app/settings/ability/AbilityPackDetailPage.tsx`
- [x] `app/settings/ability/RulesPackDetailPage.tsx`
- [x] `app/settings/subagent/` 相关组件（实际落在 SubAgentTab.tsx）
- [x] 顶部说明文案

## 实施回填（做完后填）

### 实际改动

- 与计划差异：AbilityTab 三个写函数（handleTogglePack/handleToggleSkills/persistConfig）随开关撤除整体移除（零消费者），算法平移进 config-mutations.ts 供场景页消费；新增 pack-meta.ts CATEGORY_FALLBACK 兜底（getSceneOverview 失败时分组仍可用）；AbilityPackSidebar 以「默认开启/默认关闭」徽标保留 defaultEnabled 信息；RulesPackCard 本就无开关仅文案微调；refreshKey 机制保留（切工作区 bump），写触发消失
- 改动文件清单：app/settings/ability/config-mutations.ts（新）、pack-meta.ts、AbilityPackCard.tsx、AbilityPackSidebar.tsx、AbilityPackDetailPage.tsx、RulesPackDetailPage.tsx、RulesPackCard.tsx、AbilityTab.tsx、SubAgentTab.tsx
- 验证：build:renderer / tsc --noEmit / build:electron 全过，bun test 373 pass / 0 fail；详见共享区 20260930-step3-delivery.md

### 给下一步的接力棒

- 关键签名 / 数据结构：config-mutations.ts 导出 applyPackToggle/applySkillToggles（纯函数）+ createConfigPersister（乐观更新工厂）+ buildSkillToPacks/packToggleLinksOf/EMPTY_CONFIG；⚠️ ScenePackCell.subToggles.toolPacks 含 'dogear-extension'（server 名），不能直接映射 linkedPackIds，需从 getAbilityPacks view 派生
- 下个 step 该从哪里继续：step4 场景页（app/settings/scene/）消费 getSceneOverview + config-mutations；「场景页」文案已预埋三处
- 待办或已知限制：能力页无写路径，mountsRefreshKey 仅切工作区触发
