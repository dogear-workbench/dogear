# 场景配置 v2：两层配置模型 设计

**日期**：2026-09-30
**前置**：能力区重构（场景 tab + 能力页只读化 + core-profile 退役，commit f66ceb02…aec252d5）

## 背景

能力区重构完成后用户走查反馈：场景页「只读行」信息量低、配置职责混乱——定时任务行能改工作区 `enabledToolPacks`（实为主会话扩展包细闸）、Profile 编辑器有大量无选择余地的细选、状态抽取/文章解析两行列 13 包矩阵毫无意义、任务执行提示词不可见、任务类型（代码实施 vs 其他）没有承载。

**核心模型（用户拍板）**：配置分两层——

- **场景层（场景页）**：裁决「这个场景装哪些固定层能力」（系统功能 + 上下文记忆类包）。这些包的触发条件本来就是场景属性（有无工作区路径、有无话题组、是否子会话）。
- **单元层（各功能自己的编辑页）**：只配「基础工具 + 扩展能力」。扩展能力（股票/文章/浏览器/联网/代码工作流）是「这个单元干什么活」的属性。子会话 Profile、定时任务、协作任务都是单元：Profile 在派遣页配扩展，定时任务在编辑页配工具包（已有 `toolPacksOverride`），协作任务在挂任务时由 agent 标注类型。

**有矩阵的场景不用只读**（用户拍板）：给默认预设 + 「恢复默认」按钮 + 描述中推荐使用默认。无可选能力的场景（状态抽取/文章解析）撤掉矩阵，纯文字描述 + 提示词展示。

## 目标

1. 场景页六行按两层模型重构；子会话/任务执行/定时任务固定层从代码定死升级为「预设 + 可覆盖 + 恢复默认」
2. Profile 编辑器瘦身：删 memory 勾选（归场景）、删无选择余地的细选（stock skill 细选），保留 browser 双通道与 code-workflow skill 细选
3. 协作任务加类型：`默认` / `代码实施`（挂载 staged-execution skill），CreateTask 时 agent 填写、执行时生效、任务面板可见
4. 能力页瘦身：删开关状态残留（徽章/说明/重复提示）；挂载矩阵 Profile 行加「子会话」标签
5. 状态抽取/文章解析场景行改纯文字描述 + 提示词展示

## 架构

### 1. per-scene overrides（数据模型）

`WorkspaceConfig` 新增 `sceneOverrides`，只存用户显式覆盖的 key（缺失 = 跟随）：

```ts
interface WorkspaceConfig {
  abilityOverrides?: Record<string, boolean>;      // 主会话裁决（现状不动）
  sceneOverrides?: {
    sub?: Record<string, boolean>;                 // 子会话固定层覆盖
    executor?: Record<string, boolean>;            // 任务执行固定层覆盖
    scheduler?: Record<string, boolean>;           // 定时任务固定层覆盖（memory/notes）
  };
  enabledSkills?: string[];
  enabledToolPacks?: string[];
}
```

**装配语义**：场景 X 的包开关 = `sceneOverrides.X?.[key] ?? abilityOverrides?.[key] ?? pack.defaultEnabled`，再 ∩ 场景条件（mainOnly 排除、hasWorkspace、属组等代码条件）。

- 预设 = 跟随工作区总闸（`abilityOverrides ?? default`），默认行为与现状 100% 一致，零迁移风险
- 「恢复默认」= 删 `sceneOverrides.X`（回到跟随）；主会话行恢复默认仍 = 清 `abilityOverrides`
- 排除选项 B（每场景独立真源，预设=注册表默认）：主会话关 X 而子会话场景开 X 会造成「我明明关了」的困惑，且多一份独立真源

**resolveAbilities 改造**：接收场景 overrides 入参（或新增 `resolveSceneAbilities`），按场景分流。现状子会话/执行共用工作区 `abilityOverrides` 的路径改为上述三级回退。

### 2. 矩阵格子三态

| 态 | 表现 | 例 |
|---|---|---|
| 可开关 | 预设值 + Switch + 可改 | 子会话的 memory / workspace-git / global-rules 等 |
| 强制 | 标「强制」无开关 | 子会话交付契约段（agent-collab）；定时任务笔记落卡工具（notes）；定时任务基础文件+搜索 |
| 排除 | 灰显 + 原因 | shunt 对子会话/执行/定时（mainOnly / 无人值守）；notes 对子会话；memory/notes/git/组/协作对临时会话（无工作区路径） |

强制项不给开关的理由：关掉直接破坏交付/产物机制（子会话无法回注交付、巡检报告无处落卡）。

> 实施注意：agent-collab 对子会话的现状实际装配（契约段恒注入、协作工具随属组）需在实施时核对 `tool-assembly.ts`，矩阵展示对齐真实行为。

### 3. 场景页六行形态

| 场景 | 固定层（系统类包） | 扩展层 |
|---|---|---|
| 主会话 | 开关裁决（现状，`abilityOverrides`），恢复默认=清 overrides | 本页开关（`enabledSkills`/`enabledToolPacks`，现状） |
| 临时会话 | 只读展示天然裁剪（无工作区路径/无组 → memory/notes/git/组/协作/分流排除）；global-rules 保留开关（真实注入临时会话）；workspace-rules 只读（机制生效，读 personal/agent.md） | 本页开关（personal config，现状） |
| 子会话 | 三态矩阵 + `sceneOverrides.sub`，恢复默认；subAutonomous 包（股票/文章/浏览器/联网）标「由 Profile 裁决」指引派遣页 | 指引到派遣页 |
| 任务执行 | 三态矩阵 + `sceneOverrides.executor`，恢复默认；shunt 排除（无人值守）、notes 段级裁剪保持代码条件 | 按任务类型装配（见 §5），页面放说明文字，不做控件 |
| 定时任务 | memory/notes 开关（`sceneOverrides.scheduler`，预设开=现状）+ 基础工具恒装标强制；撤掉现有 `enabledToolPacks` 编辑权（该字段回归主会话扩展细闸语义） | 指引到数据中心定时任务编辑页（`toolPacksOverride` 已有） |
| 状态抽取 | 纯文字描述 + 固定提示词展示（`loadStateExtractPrompt` 模板 + 固定 systemPrompt）+ 工具说明（emit_state_increment 单工具） | — |
| 文章解析 | 纯文字描述 + SKILL.md 提示词展示 + 工具说明；写清与 article 能力包的区别（导入管线 AI 兜底写侧 vs 会话读侧调研） | — |

场景页现有 `scheduler-custom` 行写 `enabledToolPacks` 的路径整体删除；`handleReset` 三分支改为各场景清自己的 overrides。

### 4. Profile 编辑器瘦身（SubAgentTab）

- **memory 移除**（归场景固定层）；基础工具区保持纯基础工具（Read/Write/Edit/Bash/Glob/Grep）
- **stock**：删 skill 细选（Popover + Checkbox），开关直通包内全部 skill + 四个工具包
- **article**：单开关不动
- **browser**：保留双通道细选（内嵌 vs 扩展是真实选择，风控后备语义）
- **code-workflow**：保留 6 skill 细选（唯一真实按需组合处）
- **自定义 Skill 块**：保留
- Profile 侧 memory 装配语义变化：`resolveAbilities` 的 sub 角色不再查 `profile.enabledAbilities.memory`（场景 `sceneOverrides.sub` 接管）；存量配置残留静默忽略

### 5. 协作任务类型 execProfile

- `Task` 模型（task-store）加 `execProfile: 'default' | 'code-impl'`，缺省 `'default'`（存量任务无字段 = default）
- `dogear__CreateTask` 加可选参数 `execProfile`，工具描述写判断标准：plan 为分步实施文档且要动代码 → `code-impl`；调研/整理类不填
- `buildExecutionPrompt` 按类型分支：`code-impl` 保持现有 staged-execution 语境；`default` 去掉分步实施引用，保留通用无人值守/申报纪律
- skill 装载：PiSessionConfig 加 `skillsOverride?: string[]`（executor 场景专用），tool-assembly 装配 skill 时 override 替代工作区 `enabledSkills`；task-queue 按 `execProfile` 传 `['staged-execution']` 或不传
- 任务面板任务卡片显示类型徽章（「代码实施」/「默认」）；ListTasks 返回带类型；ExecuteTask/任务详情透传
- 不做手动改类型 UI（agent 填错重挂成本低）
- 场景页 executor 行展示 `buildExecutionPrompt` 模板文本（两类各一段，静态展示）

### 6. 能力页瘦身

- 删：卡片「已关闭」徽章、侧栏「默认开启/关闭」徽章、AGENT_COLLAB_OFF_NOTE（关闭影响说明）、底部「启停配置在场景页调整；修改后需重启会话生效」重复提示
- 保留：包类型徽章（段型/skill 型）、「段 N/工具组 N/Skill N」stats、配套工具组、加载情况矩阵
- 挂载矩阵：Profile 行（kind === 'profile' | 'sub-default'）加「子会话」标签（现有「后台任务/系统预设」徽标旁）

## 模块边界

| 层 | 文件 |
|---|---|
| 注册表/解析 | `electron/main/agents/ability-registry.ts`（场景化解析、subAutonomous 展示标注）、`session-append-templates.ts` 不动 |
| 场景数据底座 | `electron/main/tipc/ability-scene.ts`（buildSceneOverview 六行重构：三态格子、subToggles 收敛、状态抽取/文章解析改 summary 型行、sceneOverrides 读写语义） |
| 工作区配置 | `electron/main/services/workspace-config-service.ts`（sceneOverrides schema + normalize） |
| 拼装 | `tool-assembly.ts`（场景 overrides / skillsOverride 消费）、`pi-session-config.ts`（skillsOverride 字段）、`conversation-runtime-service.ts`（attach 透传） |
| 任务系统 | `task-store.ts`（execProfile）、`tools/task-tools.ts`（CreateTask 参数、ListTasks 返回）、`task-queue.ts`（按类型分支提示词 + skillsOverride）、任务面板 UI（类型徽章） |
| 定时任务 | `scheduler/custom-agent-tools.ts`（memory/notes 按 sceneOverrides.scheduler） |
| 状态抽取/文章解析提示词 | tipc 新增只读路由（读 `state-extract-prompt` 模板 / 文章解析 SKILL.md） |
| 前端 | `app/settings/scene/SceneTab.tsx`、`SceneAbilityRow.tsx`（六行重构、三态、恢复默认）、`app/settings/SubAgentTab.tsx` + `subagent/AbilityBlockRow.tsx`（瘦身）、`app/settings/ability/*`（瘦身+子会话标签）、任务面板组件 |

## 数据流

- 场景页写回：拨开关 → 按 `config-mutations` 扩展（scene 版 applyPackToggle）→ 写 `updateWorkspaceConfig({ sceneOverrides })` → 重拉 overview；恢复默认 → 删对应场景 overrides 键
- 子会话固定层装配：PiSession 创建（sub）→ `resolveSceneAbilities(config, 'sub', …)` = `sceneOverrides.sub ?? abilityOverrides ?? default` ∩ 条件 ∩ Profile 扩展独裁（subAutonomous 不变）
- 执行会话：task-queue → attach(execProfile) → PiSessionConfig.skillsOverride → tool-assembly 按 override 装 skill → buildExecutionPrompt 按类型
- 定时任务：buildCustomToolSet → memory/notes 按 `sceneOverrides.scheduler`（预设装载）；可选包仍按 `toolPacksOverride ?? enabledToolPacks`

## 错误处理 / 边界情况

- `sceneOverrides` 残留下线包 key：静默忽略（与 abilityOverrides 同策略）
- 存量 Profile `enabledAbilities.memory` 残留：忽略（场景接管后字段不再读）
- 存量任务无 `execProfile`：等价 `'default'`
- executor 的 skillsOverride 为空数组 vs undefined：undefined = 不覆盖（跟随工作区），空数组也不出现（default 类型不传字段）
- personal（临时会话）不加 sceneOverrides：它的固定层天然只读，只有 global-rules 开关走 personal config 现有字段
- 定时任务行撤编辑权后，`enabledToolPacks` 仍被主会话扩展细闸与定时任务「跟随工作区」兜底消费，语义回归单一

## 未决问题

- agent-collab 子会话侧矩阵格的强制/可关呈现：实施 Step 中核对 tool-assembly 真实行为后定（倾向契约段标强制、协作工具组随开关）
- 任务执行行两类提示词展示的排版（折叠面板 vs 并列）：实施时按内容长度定
