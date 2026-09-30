# 能力区重构：场景维度 + 只读化 + core-profile 退役 设计

**日期**：2026-09-30
**状态**：已拍板

## 背景

能力页现状是 13 张能力包卡片平铺（每张卡带开关），点进详情看段模板/工具明细/挂载矩阵。「哪些场景加载哪些能力」只藏在每个包的详情页挂载矩阵里（按包看场景），缺少反向视角（按场景看包），用户想配置「某个会话场景要哪些能力」时操作动线绕。另外：

- **三大类心智没有体现在 UI 上**：系统功能 / Agent 上下文与记忆 / 扩展可选，现状全部平铺。
- **core-profile 空置数月**：两个工作区的 `workspaces/{id}/memory/core-profile.md` 均只有 45 字节空 frontmatter。职责被全局规则（agent.md 人格层）和主题记忆（跨会话稳定信号）双重接走，且没有写入动线（无纪律段引导）。决定整链路删除。
- **memory 双闸在 UI 上没讲清**：子会话 Profile 勾选记忆只生效一半（还需工作区包开关同开），`profileFilterReason` 文案未提。

## 目标

1. 删除 core-profile 全链路（包定义、装配、agent 工具、IPC、数据中心入口）
2. 能力页只读化：纯展示视角（段模板全文、工具明细、skill 描述、挂载矩阵、规则文本编辑器），撤掉所有装配开关
3. 新增「场景」tab：按会话场景维度展示与编辑能力启停，展示与控制分离
4. 三大类分组贯穿能力页与场景页

## 架构

### 核心原则：单一真源，场景页不发明新开关

场景加载 = 包开关（工作区 config）∩ 触发条件（role/groupId/hasWorkspace）∩ Profile 子开关，此语义不变（`resolveAbilities`）。场景页是**转置矩阵 + 编辑入口**：格内开关写回导致该结果的底层字段，不引入场景级独立开关真源。

| 场景 | 可编辑性 | 开关写回 | 恢复默认 |
|---|---|---|---|
| 主会话 | 13 包全量开关 | 该工作区 `abilityOverrides` | 清空 overrides（回落 `defaultEnabled`） |
| 临时会话 | 可编辑 | personal 工作区 config | 恢复 `PERSONAL_DEFAULT_CONFIG` |
| 任务执行会话 | 只读 | —（与主会话同真源，仅段级差异） | — |
| 话题状态抽取 | 只读 | 固定提示词 + 单工具，不走能力包 | — |
| 文章解析 | 只读 | SDK 独立装配，不走能力包 | — |
| 定时自定义任务 | 可编辑（仅工具包层） | `enabledToolPacks` | 清空 |

子会话（默认 Profile / 各 Profile）不进场景页：它是「多种装配」且由 Profile 子开关独裁，编辑入口留在 SubAgentTab；场景页底部放跳转说明行。

### 三大类（AbilityPack 新增 category 字段，真源在注册表）

| category | 成员（core-profile 删除后） |
|---|---|
| `system` 系统功能 | workspace-rules、global-rules、notes、agent-collab、shunt |
| `context-memory` 上下文与记忆 | memory、group-context、workspace-git |
| `extension` 扩展能力 | stock、article、browser、web-mcp、code-workflow |

大类分组头**不放开关**：三大类是展示分组不是配置单元，加大类开关等于发明第三层真源。

### 总分两级开关（场景页行内）

- 行 = 包总开关（写 `abilityOverrides`），点行展开内部细节
- 展开 = 分开关：skill 型包展开 skill 子开关（`enabledSkills`）+ 工具包子开关（`enabledToolPacks`）；纯工具包展开工具包子开关；prompt-only / segment-tools 包无展开
- 联动语义沿用现状：开总开关只补齐子开关不删，关总开关只写 overrides 不动子开关
- 定时任务场景只有工具包层（无 skill 机制）；临时会话场景总分同构（personal config 字段同构）
- 条件不满足的项**灰显 + 原因**（复用 `sceneReason` 文案），不隐藏

### 能力页与场景页的职责边界

- 能力页 = 内容/文档视角：段模板全文、工具明细、挂载矩阵（按包看场景）、**规则文本编辑器保留**（agent.md 编辑是内容编辑，非装配开关）
- 场景页 = 装配开关视角：只显示包名级开关 + 展开子开关 + 一行触发说明
- SubAgentTab 不动（除 memory 双闸文案修正）

### 排除的选项

- 合并 git/组上下文/记忆为一个「检索包」：三者数据模型与触发条件不同，合并搅乱开关语义，仅归类展示
- 跨会话搜索工具：低频（状态卡+记忆已接住大部分）、有兜底（逐会话 ReadReferenceSession），YAGNI 不做
- 场景预设档位（极简/标准/全开）：用户拍板预设 = 恢复默认（清 overrides 回落 defaultEnabled），零新增数据模型
- 场景页收编 Profile 编辑：子会话与场景分开，Profile 编辑留 SubAgentTab

## 模块边界

**主进程**：
- `electron/main/agents/ability-registry.ts` — 删 core-profile 包；AbilityPack 加 `category`；分类常量
- `electron/main/agents/pi-session/pi-session.ts` — 删 core-profile 装配注入（36、402-405、472）
- `electron/main/agents/tools/memory-tools.ts` — 删 `dogear__GetCoreProfile`/`UpdateCoreProfile`（含 registerTools 元数据）
- `electron/main/services/memory/memory-loader.ts` / `memory-fs.ts` — 删 `loadCoreProfileForSession`、coreProfilePath
- `electron/main/tipc/memory.ts` — 删画像 IPC
- `electron/main/tipc/ability.ts` — 删 core-profile case 与子会话特判；新增 `getSceneOverview({workspaceId})`
- `electron/main/services/workspace-config-service.ts` — 删 personal 默认配置 core-profile 键

**前端**：
- `app/settings/page.tsx` — 加「场景」tab
- `app/settings/AbilityTab.tsx` — 只读化 + 三大类分组；开关逻辑提取共享
- `app/settings/ability/` — AbilityPackCard/RulesPackCard/AbilityPackDetailPage 撤操作控件
- `app/settings/scene/`（新）— SceneTab、场景侧栏、SceneAbilityRow（总分行）
- 数据中心记忆面板 — 删画像查看块
- `app/types` 或 `types/electron-api.ts` — AbilityPackView 加 category、SceneOverview 类型

## 数据流

场景页装载：`client.getSceneOverview({workspaceId})` → 场景列表 + 每场景的包矩阵（key/label/category/enabled（开关现值）/loaded（最终装配）/reason/灰显标记/子开关明细）→ 渲染。
开关写回：行开关 → `client.updateWorkspaceConfig`（乐观更新 + 失败回滚模式沿用 AbilityTab.persistConfig，提取共享模块）；personal 场景同通道（workspaceId=personal）。
恢复默认：场景页按钮 → `showConfirm()` → 批量写入（清 overrides / 恢复 PERSONAL_DEFAULT_CONFIG / 清 enabledToolPacks）。

## 错误处理 / 边界

- 存量 `abilityOverrides.core-profile` 残留 key：静默忽略机制已有，无需迁移
- 存量空 `core-profile.md` 文件：留着无害，不清理
- personal config 写入：实施 Step 2 时确认 `updateWorkspaceConfig` 对 PERSONAL_WORKSPACE_ID 的支持，不支持则补
- 主进程改动需 `build:electron` 重编译验证；Vite 热重载只对前端生效
- 能力页挂载矩阵与场景页互为转置，两处并存：详情视角（按包）vs 操作视角（按场景）

## 未决问题（实施时确认）

- 数据中心记忆面板画像块的组件位置（Step 1 实施时定位）
- `types/electron-api.ts` 与主进程 `settings-types.ts` 镜像双份的同步点（如涉及）
- 场景 tab 在设置页 tab 栏的位置（建议紧跟「能力」之后）
