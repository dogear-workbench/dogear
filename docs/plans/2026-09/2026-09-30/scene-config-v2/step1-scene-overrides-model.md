---
step: 1
title: per-scene overrides 数据模型与场景化解析
status: done
---

## 目标

主进程数据层就位：`WorkspaceConfig` 加 `sceneOverrides` schema，能力解析支持场景级三级回退，registry 单测覆盖新语义。

## 依赖上下文（接力棒输入）

- 设计文档：`../scene-config-v2-design.md`（§1 per-scene overrides、§2 矩阵三态）
- 当前关键文件状态：
  - `electron/main/services/workspace-config-service.ts` — `WorkspaceConfig` 定义与读写；personal 读取时合并 `PERSONAL_DEFAULT_CONFIG`
  - `electron/main/agents/ability-registry.ts` — `resolveAbilities(config, opts)` 现状：sub 角色除 subAutonomous 外共用 `abilityOverrides`；memory 有 sub 角色 Profile 闸（`enabledAbilities.memory`）
  - `electron/main/agents/ability-registry.test.ts` — 已有解析测试
- 关键决策回顾：预设=跟随工作区总闸（不是独立真源），保证默认行为与现状一致、零迁移

## 计划改动

- [ ] `workspace-config-service.ts`：`WorkspaceConfig` 加 `sceneOverrides?: { sub?: Record<string, boolean>; executor?: Record<string, boolean>; scheduler?: Record<string, boolean> }`；读入 normalize 时过滤非法值（只留 boolean、key 静默保留不校验注册表——残留下线 key 消费侧忽略）
- [ ] `ability-registry.ts`：
  - 新增 `SCENE_KEYS = ['sub', 'executor', 'scheduler'] as const` 与类型 `SceneOverrideKey`
  - 新增导出 `scenePackEnabled(pack, config, scene)`：`config.sceneOverrides?.[scene]?.[pack.key] ?? config.abilityOverrides?.[pack.key] ?? pack.defaultEnabled`
  - `resolveAbilities` 加可选 `sceneOverride?: SceneOverrideKey` 入参：sub 角色与 executor 语义用它替换裸 `abilityOverrides` 读取；未传 = 现状行为（向后兼容现有调用点）
  - **删除 sub 角色 memory 的 Profile 闸**（`profile.enabledAbilities.memory` 不再检查）：memory 对子会话改由 `sceneOverrides.sub` + 工作区闸裁决（Profile UI 删块在 Step 6）
- [ ] `ability-registry.test.ts`：补用例——sceneOverrides 覆盖优先于 abilityOverrides；恢复默认（无 sceneOverrides 键）回落工作区总闸；sub 角色 memory 不再受 Profile 闸影响；scheduler 场景对 prompt-only 包仍受场景条件排除
- [ ] 渲染层镜像类型：`types/electron-api.ts`（或 WorkspaceConfig 前端定义处）同步 `sceneOverrides` 字段

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 测试用例 4「scheduler 场景对 prompt-only 包仍受场景条件排除」：计划表述中的 prompt-only 包（workspace-rules/global-rules）在 resolveAbilities 里本无条件可排除，按意图落地为「sceneOverride 只改开关来源、不解除场景代码条件」——用 scheduler 场景验证 shunt（mainOnly）/notes（role!=='main'）仍被条件排除 + workspace-rules（prompt-only）覆盖关闭生效
  - workspace-config-service 读入 normalize 仅作用于 sceneOverrides（泛化过滤任意场景键、只留 boolean 值）；abilityOverrides/enabledToolPacks 等既有读入行为未动（避免扩大范围）
- 改动文件清单：
  - electron/main/services/workspace-config-service.ts：WorkspaceConfig 加 sceneOverrides 三场景 schema；normalizeBooleanMap/normalizeSceneOverrides 读入过滤；getWorkspaceConfig 读入与 personal 分支、updateWorkspaceConfig 合并均接入 normalize
  - electron/main/agents/ability-registry.ts：导出 SCENE_KEYS/SceneOverrideKey/scenePackEnabled（三级回退）；ResolveAbilitiesOpts 加可选 sceneOverride；resolveAbilities 传 sceneOverride 时包开关走三级回退（未传现状不变）；删除 sub 角色 memory 的 Profile 闸（profile.enabledAbilities.memory 不再检查，JSDoc 同步更新）
  - electron/main/agents/ability-registry.test.ts：更新受 memory 闸删除影响的两个旧用例；新增 sceneOverrides 三级回退 describe（5 用例：覆盖优先、恢复默认回落、scenePackEnabled 直查、memory 脱离 Profile 闸、场景条件不被覆盖解除）
  - types/electron-api.ts：WorkspaceConfig 镜像同步 sceneOverrides 字段
- 验证：bun test 全量 379 pass / 0 fail；bun run build:electron、bun run build:renderer 均通过

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `scenePackEnabled(pack: AbilityPack, config: WorkspaceConfig, scene: SceneOverrideKey): boolean`（ability-registry.ts，三级回退真源）
  - `resolveAbilities(config, { role, hasWorkspace, groupId, profile, sceneOverride? })`：sceneOverride 传 'sub'/'executor'/'scheduler' 时包开关走三级回退；场景代码条件（mainOnly/hasWorkspace/属组/executor notes 段级裁剪）不受影响；未传行为与现状逐位一致
  - `SCENE_KEYS = ['sub', 'executor', 'scheduler'] as const`，`type SceneOverrideKey`
  - WorkspaceConfig.sceneOverrides：`{ sub?/executor?/scheduler?: Record<string, boolean> }`，读入已 normalize（非 boolean 值过滤、空归 undefined）；updateWorkspaceConfig 为整体替换语义（与 abilityOverrides 同模式）——后续「恢复默认=删单场景键」需在 config-mutations/场景 tipc 侧做增量合并后整传
- 下个 step 该从哪里继续：Step 2（ability-scene.ts buildSceneOverview 六行重构）直接消费 scenePackEnabled 与 sceneOverrides 读写；pi-session.ts 的 sub/executor 调用点接线（传 sceneOverride）在拼装改造 step 做，本 step 有意未接（保持现有调用点行为不变，仅 registry 机制就位）
- 待办或已知限制：
  - 子会话 memory 行为自本 step 起变化：Profile 闸已删，子会话 memory 默认跟随工作区闸（defaultEnabled=true）生效；Profile UI 的 memory 勾选块仍在（Step 6 删），期间 UI 拨动不再生效——属设计内过渡态
  - 拼装侧（pi-session/tool-assembly）尚未传 sceneOverride，场景 overrides 运行时未真正生效，需后续 step 接线
  - executor 段级裁剪（notes 段不裁工具组）仍在拼装侧，registry 仅透传 isExecutor，未动
