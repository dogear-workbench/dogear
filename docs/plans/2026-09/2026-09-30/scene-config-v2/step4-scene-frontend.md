---
step: 4
title: 场景页前端 v2
status: done
---

## 目标

SceneTab/SceneAbilityRow 按新数据结构重写：三态格子、sub/executor/scheduler 行编辑接线（写 sceneOverrides）、恢复默认、状态抽取/文章解析/任务执行的提示词展示。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-scene-overview.md] `ScenePackCell.state` 三态、`SceneOverviewRow.kind: 'matrix' | 'summary'`、两条提示词路由（`getStateExtractPrompt` / `getParseArticlePrompt`）、executor 行提示词文本来源（见其回填）
- 当前关键文件状态：
  - `app/settings/scene/SceneTab.tsx` — 现状 `handlePackToggle` 对 scheduler-custom 有 enabledToolPacks 特殊分支（本次删除）、`handleReset` 三分支（本次改为按场景清键）、`statusBadge`
  - `app/settings/scene/SceneAbilityRow.tsx` — 行组件：开关 + 徽标 + 展开层（skills chips + 工具包开关）
  - `app/settings/ability/config-mutations.ts` — `applyPackToggle/applySkillToggles/createConfigPersister/packToggleLinksOf`；persister 工厂按 workspaceId 写 config
- 关键决策回顾：恢复默认 = 删 `sceneOverrides.X` 整键；scheduler-custom 不再写 enabledToolPacks；subAutonomous 格子在 sub 行只读标「由 Profile 裁决」；扩展层区块在 main/personal 行保持现状渲染

## 计划改动

- [ ] `config-mutations.ts`：`applyPackToggle` 支持 scene 目标（写入 `sceneOverrides[scene][key]`，值取三级回退结果翻转）或新增 `applyScenePackToggle(config, scene, key, links, enable)`；persister 复用
- [ ] `SceneAbilityRow.tsx`：按 `cell.state` 渲染——switchable 开关、forced「强制」徽标无开关、excluded 灰显 + reason；展开层仅 switchable 且有 subToggles 的格子
- [ ] `SceneTab.tsx`：
  - 行渲染按 `row.kind` 分流：matrix 行走包清单（固定层/扩展层分区块，按 category），summary 行走新组件
  - `handlePackToggle`：按行 id 路由写回目标（main→abilityOverrides；sub/executor/scheduler-custom→sceneOverrides；personal→personal config）；删除 scheduler-custom 的 enabledToolPacks 分支
  - `handleReset`：main 清 abilityOverrides；sub/executor/scheduler-custom 清对应 sceneOverrides 键；personal 现状不动；文案统一「恢复默认（回到跟随工作区/注册表默认）」
  - 描述文案加「推荐使用默认」引导（sub/executor/scheduler-custom 三行）
- [ ] 新增 summary 行组件（scene/ 下）：状态抽取/文章解析的文字描述 + 提示词展示（调两条新路由，滚动区渲染模板文本）+ 文章解析与 article 工具区别说明（写侧兜底 vs 读侧调研）
- [ ] executor 行：固定层矩阵 + 两类执行提示词展示（default / code-impl 各一段，静态文本）+ 扩展说明（按任务类型装配，见 Step 5）
- [ ] footer「子会话按 Profile 独立配置能力，不在场景页展示」文案更新为新语义（场景页 sub 行 + 派遣页分工）
- [ ] 验证：`bun run build:renderer`；dev 目验六行渲染、开关写回、恢复默认、提示词展示

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `applyScenePackToggle` 未按计划携带联动逻辑（不补齐/删除工作区 enabledSkills/enabledToolPacks）：场景行真源是 sceneOverrides，联动写共享细闸字段会对主会话产生跨场景副作用（如在 executor 行关 browser 会删主会话工具包）；双闸语义即现状装配行为，reason 文案已说明。applyPackToggle 联动仅保留在 main/personal 行
  - executor 行提示词从计划的单段扩为两段（default / code-impl 各一）：buildExecutionPrompt 加可选 `execProfile?: 'default' | 'code-impl'`（缺省 code-impl 逐字保持现状模板；default 分支去掉分步实施/staged-execution 引用，保留通用无人值守/申报纪律），授权范围内最小扩展，task-queue 调用点未动
  - executor/summary 行的提示词展示统一收敛到新组件 ScenePromptsPanel（带 content 随行渲染，其余按 id 走 getStateExtractPrompt/getParseArticlePrompt 只读路由拉取）
  - `editable` 兼容字段已删（ScenePackCell + SceneOverviewRow 两处，含全部赋值点与注释）；SceneTab 侧栏「只读」徽标改按 `row.kind === 'summary'`，恢复默认按钮按 `row.kind === 'matrix'`，冒烟脚本断言同步更新（另加无 editable 字段断言、双模板断言）
  - 六行 description 改为面向用户措辞（不再暴露 sceneOverrides.X 等内部字段名），sub/executor/scheduler-custom 三行加「推荐使用默认」引导；scheduler-parse 修「兑底→兜底」错别字并扩写与 article 包分工说明（写侧兜底 vs 读侧调研）
- 改动文件清单：
  - `electron/main/services/task-execution-prompt.ts`：ExecProfile 类型 + execProfile 可选参 + default/code-impl 双分支
  - `electron/main/tipc/ability-scene.ts`：删 editable 兼容字段；EXECUTOR_PROMPTS 两条；六行 description 面向用户化
  - `app/settings/ability/config-mutations.ts`：新增 SceneOverrideKey（从 WorkspaceConfig 派生）+ applyScenePackToggle
  - `app/settings/scene/SceneAbilityRow.tsx`：按 cell.state 三态渲染（switchable 开关 / forced「强制」徽标 / excluded「排除」徽标+灰显），展开层仅 switchable 且有 subToggles
  - `app/settings/scene/ScenePromptsPanel.tsx`：新建，提示词展示面板（extensionNote + prompts 滚动区）
  - `app/settings/scene/SceneTab.tsx`：行渲染按 kind 分流；handlePackToggle 路由（sceneOverrides 单键增量合并整传）；handleReset 按 sceneOverrides 删整键；删 enabledToolPacks 特殊分支；footer 新分工文案；清除历史 lint error（AbilityCategoryMeta 未使用）
  - `scripts/scene-overview-smoke.ts`：断言同步（删 editable 断言、加双模板与无 editable 字段断言），53 项全过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `applyScenePackToggle(config, scene: 'sub'|'executor'|'scheduler', key, enable) → Partial<WorkspaceConfig>`（sceneOverrides 单键增量合并，updateWorkspaceConfig 整体替换语义）；SceneOverrideKey 从 `WorkspaceConfig['sceneOverrides']` 键派生，主进程 SCENE_KEYS 对应
  - `buildExecutionPrompt(input)` 的 `input.execProfile?: ExecProfile`（缺省 'code-impl'）；Step 5 task-queue 按 task.execProfile 显式传参即可
  - 前端不再读 `editable`（已删）；matrix/summary 行分流靠 `row.kind`，写回路由靠 SceneTab 的 SCENE_OVERRIDE_BY_ROW 映射
- 下个 step 该从哪里继续：Step 5（execProfile 任务类型）改 task-store/Task、CreateTask zod 参数、task-queue 传 execProfile 与 skillsOverride、任务面板类型徽章；场景页侧无需再动
- 待办或已知限制：
  - 视觉/交互目验不可行（无人值守），需用户 dev 目验清单见共享区 step4-delivery.md
  - SceneTab 的 handleSkillToggle/handleToolPackToggle 现仅 main/personal 行可达（subToggles 仅这两行），无需场景路由
