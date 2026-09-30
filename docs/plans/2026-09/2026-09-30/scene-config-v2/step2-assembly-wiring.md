---
step: 2
title: 拼装侧消费
status: done
---

## 目标

真实装配链路按 sceneOverrides 生效：子会话/任务执行的工具与段装配、定时任务 memory/notes 装载；PiSessionConfig 加 skillsOverride 字段（本步只加字段与消费，task-queue 接线在 Step 5）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-scene-overrides-model.md] `scenePackEnabled(pack, config, scene)` 三级回退；`resolveAbilities` 加 `sceneOverride` 入参；sub 角色 memory 不再查 Profile 闸
- 当前关键文件状态：
  - `electron/main/agents/pi-session/tool-assembly.ts` — 工具集与 skill 拼装，消费 `resolveAbilities`
  - `electron/main/agents/pi-session/pi-session-config.ts` — PiSessionConfig（conversationId/modelSelection/enabledToolPacks/executor 等）
  - `electron/main/agents/pi-session/pi-session.ts` — 会话创建入口，config 消费点
  - `electron/main/services/scheduler/custom-agent-tools.ts` — `buildCustomToolSet` 现状 memory/notes 恒装（硬编码）
- 关键决策回顾：sceneOverrides 只影响 sub/executor/scheduler 三场景；主会话/临时会话装配不变；skillsOverride 仅 executor 用、undefined=不覆盖

## 计划改动

- [ ] `pi-session-config.ts`：加 `skillsOverride?: string[]`
- [ ] `tool-assembly.ts`：
  - 子会话装配路径（role='sub'）传 `sceneOverride: 'sub'`
  - executor 装配路径传 `sceneOverride: 'executor'`（executor 的段级裁剪——shunt 排除、notes-discipline 排除——保持现状代码条件）
  - skill 装配：`config.skillsOverride` 有值时替代工作区 `enabledSkills` 做过滤（subAutonomous 包不受影响，executor 不涉及其装配差异）
  - **核对 agent-collab 子会话侧真实行为**（契约段/协作工具的注入条件），结果写进实施回填——Step 3 的矩阵「强制/可关」呈现依赖此结论
- [ ] `custom-agent-tools.ts`：`buildCustomToolSet` 读工作区 config 的 `sceneOverrides.scheduler`，memory/notes 工具组按其裁决（无键 = 装载，等价现状）；基础文件+搜索恒装不动
- [ ] 编译验证：`bun run build:electron`；grep 确认 `resolveAbilities` 所有调用点已按场景传参或确认保持现状的理由

## 实施回填（做完后填）

### 实际改动
- 与计划差异：resolveAbilities 与 skill 装配的真实代码位置在 `pi-session.ts start()`（tool-assembly 只消费解析结果），sceneOverride 传参与 skillsOverride 消费均落在 pi-session.ts，**tool-assembly.ts 零改动**，语义与计划一致；skillsOverride 消费语义明确为「权威清单绕过 enabledSkills 与包总闸两层」，否则 staged-execution 被默认关的 code-workflow 包挡掉，code-impl 意图落空
- 改动文件清单：
  - `pi-session-config.ts`：加 `skillsOverride?: string[]`
  - `pi-session.ts:396`：resolveAbilities 传 `sceneOverride: role==='sub' ? 'sub' : executor ? 'executor' : undefined`
  - `pi-session.ts:444-462`：非 sub 分支 skillsOverride 有值时 `allSkillEntries.filter(e => overrideSet.has(e.name))`
  - `custom-agent-tools.ts`：readWorkspaceConfig 读完整 config，memory/notes 按 `scenePackEnabled(pack, config, 'scheduler')` 裁决，无键=装载=现状

### 给下一步的接力棒
- 关键签名 / 数据结构：PiSessionConfig.skillsOverride?: string[]（undefined=跟随工作区 enabledSkills，仅 executor 场景由 task-queue 设置）；buildCustomToolSet 签名不变
- agent-collab 子会话装配结论：契约段注入条件 = config.subAgent 存在（不查包开关不要求 groupId，恒注入，强制）；dogear-group + dogear-delegation 属组恒装（强制）；dogear-sibling 随 agent-collab 包、dogear-group-context 随会话组包（可关）。设计文档「协作工具组随开关」的倾向与真实行为不符（只有 sibling 随开关），矩阵文案需写清非对称；注册表 segmentKeys 含 sub-agent-contract 但真实注入点在 activeAbilities 判定外
- 下个 step 该从哪里继续：Step 3 场景页重构；注意 tipc/ability-scene.ts scheduler 行（:151/:167）注释与 buildCustomToolSet 新行为（memory/notes 查 sceneOverrides.scheduler）有偏差，重构 buildSceneOverview 时一并对齐
- 待办或已知限制：skillsOverride 空数组语义未特判（规范说不出现，出现则按字面装零个 skill）；conversation-runtime-service attach 透传 skillsOverride 待 Step 5

验证：build:electron 通过；ability-registry + tool-registration-smoke 37 测试全过；渲染层无 PiSessionConfig 镜像无需同步。交付文档：共享区 20261001-step2-delivery.md
