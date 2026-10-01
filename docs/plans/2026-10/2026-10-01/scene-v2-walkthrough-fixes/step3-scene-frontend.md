---
step: 3
title: 场景页前端
status: done
---

## 目标
SceneTab/SceneAbilityRow 适配 step2 的新行结构（分组 note、撤掉的格子），ScenePromptsPanel 富渲染对齐能力页风格。

## 依赖上下文（接力棒输入）
- 前置 step2 产出：buildSceneOverview 行结构（groupNote 字段名/位置、personal 行新格子集合、sub/scheduler 扩展分组无格子）——以 step2 回填的接力棒为准
- 关键现状：`SceneTab.tsx:22-27` statusBadge（excluded&&loaded 绿徽标分支待删）、:246-324（行渲染 + ScenePromptsPanel 挂载）；`ScenePromptsPanel.tsx`（pre 等宽 + max-h-72 内滚，PromptText:11-16）；能力页参照 `AbilityPackDetailPage.tsx` 的 MarkdownRenderer 用法
- handleSkillToggle/handleToolPackToggle（SceneTab.tsx:257-270）写 enabledSkills/enabledToolPacks——subToggles 收敛后仅 code-workflow 行还会用到，逻辑保留不动

## 计划改动
- [x] `SceneTab.tsx`：删 statusBadge excluded&&loaded「已装载」分支；渲染分组级 note（扩展能力分组下的说明 + 跳转按钮：子会话行→子会话派遣页、定时任务行→数据中心定时任务）；跳转用现有路由跳转模式（参考页脚「前往子会话派遣页」链接实现）
- [x] `SceneAbilityRow.tsx`：确认三态渲染在格子减少后无死分支；如 personal 行固定层不再有 excluded 格，确认样式不破
- [x] `ScenePromptsPanel.tsx`：PromptText 从 `<pre>` 改 MarkdownRenderer 渲染；删 max-h-72 高度上限与内滚（跟随页面滚动）；卡片样式对齐能力页详情（标题加粗 + muted 说明行 + 正文区）；executor 静态模板两段同款
- [x] 验证：`npx tsc --noEmit -p tsconfig.json` 通过；场景页六行目验（每行：格子在位、note 显示、提示词面板全文渲染）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - handleToolPackToggle 一并删除（文档原说保留）：其唯一消费者 SceneAbilityRow 的 toolPacks 渲染按接力棒删除后它成死代码，按「不留半成品」清理；config-mutations.ts 共享逻辑未动
  - 定时任务跳转落到 `/data-center` 页（DataCenterPage 的 scheduler tab 是页内本地 state，无 URL 参数机制；直达 tab 需改 data-center/page.tsx，超出本步边界）——用户需再点一下「定时计划」tab
  - executor 静态模板实为单段（接力棒已预告），走 prompt.content 同一渲染路径无需特判
- 改动文件清单：`app/settings/scene/SceneTab.tsx`（statusBadge 死分支、groupNotes 渲染 + 跳转按钮、页头/页脚/confirm 新文案、删 handleToolPackToggle）、`app/settings/scene/SceneAbilityRow.tsx`（删 toolPacks/bundled/onToolPackToggle、badge 统一 muted、展开层只剩 Skill chips）、`app/settings/scene/ScenePromptsPanel.tsx`（MarkdownRenderer 富渲染、删内滚、卡片化对齐能力页、fetchSections label 新文案）、`electron/main/tipc/ability-scene.ts`（最小类型同步：删 SceneSubToggleToolPack 与 toolPacks 字段，数据逻辑零改动）
- 验证：`npx tsc --noEmit -p tsconfig.json` / `npx tsc --noEmit -p tsconfig.electron.json` / `bun run build:electron` 全部通过；人工目验清单见共享区 `20261001-walkthrough-step3-delivery.md`；代码未提交（主会话统一 commit）

### 给下一步的接力棒
- 关键签名 / 数据结构：`ScenePackSubToggles` 只剩 `skills` 字段，`SceneSubToggleToolPack` 类型已删；分组渲染模式 = groupNotes 先渲染后判空（SceneTab categories.map 内），note 卡内按 `selectedRow.id` 附加跳转按钮；定时任务跳转 = `navigate('/data-center') + closeSettings()`
- 下个 step 该从哪里继续：step4（TaskEditorPage/SubAgentTab）：定时任务编辑页加 skill 挂载选择区（skillsOverride，plan-validate sanitize 归一）、Profile 编辑器 browser 双通道细选砍成单开关
- 待办或已知限制：数据中心「定时计划」tab 无直达入口（可选后续项：给 DataCenterPage 加初始 tab 机制，可仿 syncPanelFocusAt 的 store 焦点模式）
