---
step: 3
title: 场景总览重构与提示词路由
status: done
---

## 目标

`buildSceneOverview` 输出两层模型六行数据（三态格子），状态抽取/文章解析行改为摘要型；新增两条提示词只读 tipc 路由。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-assembly-wiring.md] 拼装侧已按 sceneOverrides 生效；agent-collab 子会话装配结论（见其回填）
- 当前关键文件状态：
  - `electron/main/tipc/ability-scene.ts` — `buildSceneOverview` 现状六行 × 13 包矩阵：main/personal/scheduler-custom 可编辑，executor/scheduler-state/scheduler-parse 只读；`schedulerCustomCell` 消费 `enabledToolPacks`
  - `electron/main/services/memory/state-extract-prompt.ts` — `loadStateExtractPrompt(configDir)` 读磁盘模板
  - 文章解析 SKILL.md 路径：task payload `skillsDir`（`.dogear` 内文章解析技能目录），解析入口 `parse-article-task.ts` 的 `loadArticleParseSkill`
- 关键决策回顾：三态 = switchable/forced/excluded；scheduler-custom 行撤掉 enabledToolPacks 编辑权（toggleable 分支删除）；状态抽取/文章解析不再列 13 包

## 计划改动

- [ ] `ability-scene.ts` 类型重构：
  - `ScenePackCell` 加 `state: 'switchable' | 'forced' | 'excluded'`（替代 editable 布尔语义；excluded 格子 enabled=false）
  - `SceneOverviewRow` 加 `kind: 'matrix' | 'summary'`（summary 行不产 packs 矩阵）；固定层/扩展层区块标注字段（`sections?: { fixed: boolean; extension: boolean }` 供前端分渲染，或前端按 category 自分——按实施顺手定，回填记录）
- [ ] 六行数据重写：
  - `main`：现状不动（全 switchable）
  - `personal`：固定层格子改 `excluded`（无工作区路径/无组的包）或 forced 说明；global-rules 保持 switchable；扩展包 switchable
  - 新增 `sub` 行（替代现状 sub 信息散在挂载矩阵）：固定层 switchable（写回 `sceneOverrides.sub`）+ subAutonomous 四包标 excluded（reason「由 Profile 裁决」）+ agent-collab 按 Step 2 结论标 forced 或 switchable
  - `executor`：固定层 switchable（写回 `sceneOverrides.executor`）；shunt excluded（无人值守）；扩展说明字段（按任务类型，指向 Step 5 的 execProfile）
  - `scheduler-custom`：memory/notes switchable（写回 `sceneOverrides.scheduler`）+ 基础工具 forced + 可选包层移除（reason 指引任务编辑页）；删除 `schedulerCustomCell` 的 enabledToolPacks 消费
  - `scheduler-state` / `scheduler-parse`：改 summary 行（description + 提示词路由参数提示）
- [ ] `executor` 行带 `buildExecutionPrompt` 模板文本（从 task-queue 抽出模板纯函数到共享位置，或 tipc 内联同款文案——单一来源，回填记录选择）
- [ ] tipc 新增两条只读路由（挂 `ability-scene.ts` 或独立文件）：
  - `getStateExtractPrompt()` → `{ systemPrompt, template }`（读 `loadStateExtractPrompt`）
  - `getParseArticlePrompt()` → `{ systemPrompt, skillMd }`（读文章解析 SKILL.md，复用/抽出 `loadArticleParseSkill`）
- [ ] 冒烟：bun 脚本直调 `buildSceneOverview` 与两条新路由，核对三态与文案；`build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - executor 模板文本选了「抽出共享纯函数」方案：新建 `services/task-execution-prompt.ts`（buildExecutionPrompt + EXECUTION_PROMPT_PREVIEW 占位实参），task-queue 与场景页共用单一来源；场景页经 row.prompts[0].content 随行返回（纯内存零 IO，不走路由）；Task.planPath 为 `string | undefined`，task-queue 在守卫后局部收窄并透传 runExecutionTurn
  - 状态抽取 systemPrompt 原是 state-extract-task 内联字面量，抽为 `STATE_EXTRACT_SYSTEM_PROMPT` 常量到 state-extract-prompt.ts（任务与路由同源）
  - 类型兼容策略：`editable` 未删（旧前端 SceneTab/SceneAbilityRow 编译依赖），main/personal/scheduler-custom 行 = state==='switchable' 派生；sub/executor 行恒 false（旧前端无 sceneOverrides 写回路径，禁用防误写 abilityOverrides），Step 4 前端按 state 渲染后删 editable
  - 未加 sections 区块标注字段：前端已按 cell.category 分组渲染，固定层/扩展层由 category==='extension' 自分；matrix/summary 用行级 kind 区分
  - executor 扩展格子标 switchable（sceneOverrides.executor 对扩展包真实生效：role=main 解析无 Profile 过滤），「不做控件」语义由行级 extensionNote 承载，渲染形态由 Step 4 决定
  - scheduler 可选包格子 excluded 但 loaded 保留真实值（工作区 enabledToolPacks 命中近似，任务级 toolPacksOverride 不可知），reason 指引任务编辑页
  - personal workspace-rules 标 forced（机制级只读），enabled/loaded 走真实装配（PERSONAL_DEFAULT_CONFIG 默认关该包 → loaded=false），reason 写明
- 改动文件清单：
  - electron/main/services/task-execution-prompt.ts（新建：buildExecutionPrompt + EXECUTION_PROMPT_PREVIEW）
  - electron/main/services/task-queue.ts（删本地函数改 import；planPath 收窄透传 runExecutionTurn）
  - electron/main/services/memory/state-extract-prompt.ts（导出 STATE_EXTRACT_SYSTEM_PROMPT）
  - electron/main/agents/tasks/state-extract-task.ts（改用常量）
  - electron/main/agents/tasks/parse-article-task.ts（导出 loadArticleParseSkill；新增 readArticleParseSkillMd）
  - electron/main/tipc/ability-scene.ts（类型三态重构 + 七行数据 + schedulerCustomAgentCell 对齐 sceneOverrides.scheduler + sceneReason agent-collab 非对称文案）
  - electron/main/tipc/ability.ts（getStateExtractPrompt / getParseArticlePrompt 两条只读路由）
  - scripts/scene-overview-smoke.ts + scripts/mock-electron-preload.ts（冒烟：DOGEAR_CONFIG_DIR=… bun --preload ./scripts/mock-electron-preload.ts scripts/scene-overview-smoke.ts，51 项断言全过）
- 验证：bun run build:electron ✓、bun run build:renderer ✓（旧前端不改零编译错）、bun test 378 pass / 0 fail、冒烟 51 项全过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SceneCellState = 'switchable' | 'forced' | 'excluded'`；ScenePackCell：state/enabled/loaded/reason(+subToggles 仅 main/personal)；三态渲染：switchable=Switch+预设值、forced=「强制」徽标无开关、excluded=灰显+reason
  - SceneOverviewRow：kind('matrix'|'summary')/description/packs/prompts?/extensionNote?；SceneOverviewId 新增 'sub'（排 personal 后）
  - summary 行 packs 恒空；prompts[].id='state-extract'|'parse-article' 经新路由拉全文（getStateExtractPrompt → {systemPrompt,template}；getParseArticlePrompt → {systemPrompt,skillMd}）；executor 行 prompts[0].content 直接带模板全文（id='executor'，无需路由）
  - scheduler-custom 行首合成格 key='__scheduler-base__'（category system、state forced、恒 loaded）
- 下个 step 该从哪里继续：Step 4 SceneTab/SceneAbilityRow 重构——三态渲染、sub 行开关写回 sceneOverrides.sub（增量合并单键后 updateWorkspaceConfig 整传）、恢复默认=删对应场景整键（main 行仍清 abilityOverrides）、summary 行接两条提示词路由、executor 行渲染 extensionNote+模板全文（扩展层不做控件）、完成后删 editable 兼容字段
- 待办或已知限制：
  - 兼容期 sub/executor 行 cell.editable=false，旧前端开关禁用（数据 state 仍 switchable）
  - 旧前端 handleReset 无 sub/executor 分支（行头「恢复默认」按钮因 row.editable=true 会出现但点击无效果），Step 4 接管
  - 挂载矩阵（能力页）仍展示 13 包 × 场景（未在本 step 范围）；sub-default 行 agent-collab 文案已随 sceneReason 同步非对称化
