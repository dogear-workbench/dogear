---
step: 4
title: 场景 tab 新增
status: done
---

## 目标

设置页新增「场景」tab：六场景侧栏（三可编辑 + 三只读）、三大类分组的能力清单、总分两级开关、恢复默认、灰显策略，全部写回底层真源。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2] `client.getSceneOverview({workspaceId})` 返回 `SceneOverviewRow[]`；[step3] `app/settings/ability/config-mutations.ts` 提供 `persistConfig`/`applyPackToggle`/`applySkillToggles` 纯函数
- 关键决策回顾：场景页不发明新开关真源；大类分组头无开关；灰显不隐藏；personal 场景写 personal config；恢复默认 = 清字段回落 defaultEnabled，先 showConfirm
- 数据注意：`enabled`（开关现值）与 `loaded`（最终装配）分开渲染——行开关绑定 enabled，灰显行展示 loaded/reason

## 计划改动

- [x] `app/settings/page.tsx`
- [x] 新建 `app/settings/scene/SceneTab.tsx`
- [x] 新建 `app/settings/scene/SceneAbilityRow.tsx`
- [x] 场景详情页三大类分组渲染（用 getSceneOverview categories + CATEGORY_FALLBACK）
- [x] 只读场景页（executor/state-extract/parse-article）
- [x] 定时任务场景
- [x] 恢复默认按钮
- [x] 页面底部说明行
- [x] 临时会话场景顶部说明

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - 分组数据用 getSceneOverview 返回的 categories（非直接 import ABILITY_CATEGORIES，主进程常量不进 renderer），CATEGORY_FALLBACK 兜底
  - 只读场景说明直接用后端 row.description 原文（executor 文案语义等价，单一来源不重复造）
  - 跳转子会话派遣页：page.tsx Tabs 从 defaultValue 改为受控 value/onValueChange
  - 新增细节：bundled 工具组（dogear-extension）子开关行灰显标「随包整体装载，无独立开关」（用 links.linkedPackIds 判断）；getAbilityPacks 失败时 skill chips 整体禁用
  - personal 恢复默认写空三件套 { enabledToolPacks:[], enabledSkills:[], abilityOverrides:{} }，读时回落 PERSONAL_DEFAULT_CONFIG
- 改动文件清单：
  - 新建 app/settings/scene/SceneTab.tsx（数据加载/写回/恢复默认/六场景侧栏/分组详情/底部跳转）
  - 新建 app/settings/scene/SceneAbilityRow.tsx（单包行：开关+徽标+reason+可展开子开关区）
  - 修改 app/settings/page.tsx（Tabs 受控 + scene tab，位于 abilities 与 profiles 之间）

### 给下一步的接力棒

- 关键签名 / 数据结构：
  - SceneTab 组件 props：{ onGoToSubAgent: () => void }
  - 写回统一走 createConfigPersister 双实例：wsPersister（当前工作区）/ personalPersister（PERSONAL_WORKSPACE_ID）；成功与失败均 reloadAfterWrite 重拉 overview+config（消除 personal 空数组回落 ['web-mcp'] 的本地漂移）
  - 行开关联动素材 linksByKey = packToggleLinksOf(getAbilityPacks view) 按 key 建 Map；bundled 工具组判断 = links 存在但 id 不在 linkedPackIds
  - scheduler-custom 行开关 = linkedPackIds 集合增删 enabledToolPacks
- 下个 step 该从哪里继续：step5 文档同步，UI 侧新增内容见上；能力页三处「场景页」预埋文案已语义成立无需改
- 待办或已知限制：toggle 处理器读 config 是当次渲染闭包值，快速连续点击存在竞态窗口（乐观更新+失败重拉兑底，与 AbilityTab 现状一致）
