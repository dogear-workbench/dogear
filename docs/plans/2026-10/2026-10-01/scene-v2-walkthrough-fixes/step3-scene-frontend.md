---
step: 3
title: 场景页前端
status: pending
---

## 目标
SceneTab/SceneAbilityRow 适配 step2 的新行结构（分组 note、撤掉的格子），ScenePromptsPanel 富渲染对齐能力页风格。

## 依赖上下文（接力棒输入）
- 前置 step2 产出：buildSceneOverview 行结构（groupNote 字段名/位置、personal 行新格子集合、sub/scheduler 扩展分组无格子）——以 step2 回填的接力棒为准
- 关键现状：`SceneTab.tsx:22-27` statusBadge（excluded&&loaded 绿徽标分支待删）、:246-324（行渲染 + ScenePromptsPanel 挂载）；`ScenePromptsPanel.tsx`（pre 等宽 + max-h-72 内滚，PromptText:11-16）；能力页参照 `AbilityPackDetailPage.tsx` 的 MarkdownRenderer 用法
- handleSkillToggle/handleToolPackToggle（SceneTab.tsx:257-270）写 enabledSkills/enabledToolPacks——subToggles 收敛后仅 code-workflow 行还会用到，逻辑保留不动

## 计划改动
- [ ] `SceneTab.tsx`：删 statusBadge excluded&&loaded「已装载」分支；渲染分组级 note（扩展能力分组下的说明 + 跳转按钮：子会话行→子会话派遣页、定时任务行→数据中心定时任务）；跳转用现有路由跳转模式（参考页脚「前往子会话派遣页」链接实现）
- [ ] `SceneAbilityRow.tsx`：确认三态渲染在格子减少后无死分支；如 personal 行固定层不再有 excluded 格，确认样式不破
- [ ] `ScenePromptsPanel.tsx`：PromptText 从 `<pre>` 改 MarkdownRenderer 渲染；删 max-h-72 高度上限与内滚（跟随页面滚动）；卡片样式对齐能力页详情（标题加粗 + muted 说明行 + 正文区）；executor 静态模板两段同款
- [ ] 验证：`npx tsc --noEmit -p tsconfig.json` 通过；场景页六行目验（每行：格子在位、note 显示、提示词面板全文渲染）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
