# 场景配置 v2 实施计划

**目标**：落地两层配置模型——场景页裁决各场景固定层（预设+可覆盖+恢复默认）、单元页只配基础工具与扩展；协作任务加 execProfile 类型；能力页与 Profile 编辑器瘦身。

**架构思路**：设计见 `../scene-config-v2-design.md`。核心是 `WorkspaceConfig.sceneOverrides`（sub/executor/scheduler 三场景，装配三级回退 `sceneOverrides.X ?? abilityOverrides ?? defaultEnabled`），预设跟随工作区总闸保证零迁移；拼装侧（tool-assembly / buildCustomToolSet）与展示侧（buildSceneOverview）同步消费；任务执行扩展走 PiSessionConfig.skillsOverride。排除选项：每场景独立真源（主会话关 X 子会话仍开会造成困惑）。

**涉及模块**：workspace-config-service、ability-registry、ability-scene（tipc）、tool-assembly、pi-session-config、conversation-runtime-service、task-store、task-tools、task-queue、scheduler/custom-agent-tools、app/settings/scene/*、SubAgentTab、ability/*、任务面板组件。

## 步骤索引

- [x] [Step 1: per-scene overrides 数据模型与场景化解析](./step1-scene-overrides-model.md) — config schema + resolveSceneAbilities 三级回退 + registry 测试
- [ ] [Step 2: 拼装侧消费](./step2-assembly-wiring.md) — tool-assembly/子会话/执行/定时任务按 sceneOverrides 装配 + skillsOverride 字段
- [ ] [Step 3: 场景总览重构与提示词路由](./step3-scene-overview.md) — buildSceneOverview 三态格子六行重构 + 状态抽取/文章解析提示词只读路由
- [ ] [Step 4: 场景页前端 v2](./step4-scene-frontend.md) — SceneTab/SceneAbilityRow 六行重构、恢复默认、提示词展示页
- [ ] [Step 5: 任务类型 execProfile 全链路](./step5-exec-profile.md) — Task 模型/CreateTask 参数/提示词分支/skillsOverride 接线/任务面板徽章
- [ ] [Step 6: Profile 与能力页瘦身 + 文档同步](./step6-slim-and-docs.md) — SubAgentTab 删 memory/stock 细选、能力页删开关残留+子会话标签、doc-sync

## 全局决策

- **装配语义**：场景 X 包开关 = `sceneOverrides.X?.[key] ?? abilityOverrides?.[key] ?? pack.defaultEnabled`，再 ∩ 场景条件（mainOnly/hasWorkspace/属组等代码条件不变）
- **矩阵三态**：`switchable`（预设值+可改）/ `forced`（标「强制」无开关：子会话交付契约、定时任务笔记落卡与基础工具）/ `excluded`（灰显+原因：shunt 对非主会话、memory 等对临时会话）
- **恢复默认** = 删 `sceneOverrides.X` 整键（回跟随工作区）；主会话行恢复默认 = 清 `abilityOverrides`（现状不变）
- **execProfile**：`'default' | 'code-impl'`，缺省 default；`code-impl` = 挂载 staged-execution skill（skillsOverride 机制）；CreateTask 参数描述写判断标准（分步实施文档且动代码）
- **skillsOverride**：PiSessionConfig 可选字段，`undefined` = 不覆盖（跟随工作区 enabledSkills），仅 executor 场景使用
- **残留策略**：sceneOverrides 残留下线 key、存量 `enabledAbilities.memory` 残留一律静默忽略；`enabledAbilities.memory` 类型字段保留（数据兼容），UI 与解析不再消费
- **personal 不加 sceneOverrides**：临时会话固定层天然只读，global-rules 开关走 personal config 现有字段
- 类型双份同步：`types/` 渲染层与 `electron/main/` 主进程镜像类型改动需两处同步
- 主进程改动后必须 `bun run build:electron` 验证；前端 `bun run build:renderer`
- 不写注释（仅 WHY 非显而易见处一行）；任务工具 schema 用 zod 严格校验；错误 `isError: true` 不抛异常
