---
step: 2
title: buildSceneOverview 重构
status: done
---

## 目标
六行数据结构按 design.md §2/§3 修正，subToggles 只留 code-workflow，徽标死代码清理，全部行 description 与格子 reason 换新文案。

## 依赖上下文（接力棒输入）
- 前置 step1 产出：定时任务 skillsOverride 链路已通（本步定时任务行文案提到「工具包与 skill」即有实指）
- 关键现状（事实报告 A/B/G 节，文件 `electron/main/tipc/ability-scene.ts`）：mainCell:472（subToggles 生成）、personalCell:491 + PERSONAL_EXCLUDED_KEYS:460 + personalSceneReason:116、subCell:525（subAutonomous excluded + code-workflow switchable）、schedulerCustomCell:595 + schedulerCustomAgentCell/schedulerPackHitCell:154-202（loaded 计算）、六行 description:660-716
- 配套：`SceneTab.tsx:22-27` statusBadge 的 excluded&&loaded 分支（本步只删数据侧 loaded 传递，前端分支留 step3 一起删）

## 计划改动
- [x] `mainCell`/`personalCell`：subToggles 仅 code-workflow 生成（`pack.key === 'code-workflow' && pack.type === 'skill-packs'`），其余 skill-packs 不带 subToggles
- [x] `personalCell`：删 workspace-rules 格子；PERSONAL_EXCLUDED_KEYS 相关包不再逐格输出，改为行级一句说明（文案见 design §2/§7）；global-rules 与扩展包保留
- [x] `subCell`：扩展分组五包全部不再输出格子，改为分组级 note 字段「扩展能力（股票/文章/浏览器/联网/代码 skill）在派遣页按 Profile 勾选」；固定层格子与 sceneOverrides.sub 开关不变
- [x] `schedulerCustomCell`：扩展分组五包撤格子换分组级 note「扩展工具包与 skill 在定时任务编辑页按任务配置」；__scheduler-base__ 强制格与 memory/notes 开关保留；删除 schedulerCustomAgentCell/schedulerPackHitCell 的 loaded 命中计算
- [x] `profileFilterReason`：删 memory 残留分支（装配侧已不查 Profile memory 闸）
- [x] 六行 description + 全部 reason 按新文案基准重写（design §7 基调：一句话、说人话）；恢复默认 confirm 文案在前端 SceneTab.tsx，超出本步边界留 step3
- [x] 行数据结构加 `groupNotes` 字段（分组级说明，category key → 文案的 map），类型随文件导出自动同步前端
- [x] 验证：`bun run build:electron` 通过（渲染层 tsc 亦通过，前端零适配）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：分组级字段定名 `groupNotes`（`Partial<Record<AbilityCategoryMeta['key'], string>>`，仅 sub/scheduler-custom 两行携带 `{ extension: '...' }`）；恢复默认 confirm 文案在 SceneTab.tsx 留 step3；toolPackToggleList/BUNDLED_GROUP_LABELS/ctx 三个字段等死代码连带清理；EXECUTOR_PROMPTS 单段 id 改 `executor-template`（原 `executor-default`；state-extract/parse-article 是拉取路由 key 未动）；schedulerPackHitCell 整删后能力页矩阵 scheduler 行 skill-packs 包 loaded 恒 false + 按任务配置说明（排除+已装载矛盾在数据侧根除）。详见共享区 20261001-step2-delivery.md
- 改动文件清单：electron/main/tipc/ability-scene.ts（763→689 行）

### 给下一步的接力棒
- 关键签名 / 数据结构：personalCell/subCell/schedulerCustomCell 返回 `ScenePackCell | null`；`SceneOverviewRow.groupNotes` 为新增字段；数据侧已不产生 excluded&&loaded 格子，SceneTab statusBadge 该分支成死代码
- 下个 step 该从哪里继续：step3 前端——渲染 groupNotes（注意空组先渲染 note 再判空）、删 statusBadge excluded&&loaded 分支与 SceneAbilityRow bundled/toolPacks 死分支、SceneTab 页头页脚/三段 confirm 文案、ScenePromptsPanel 富渲染（design §6）
- 待办或已知限制：sceneOverrides.sub 的 code-workflow 残键静默忽略；ScenePackSubToggles.toolPacks 字段保留（恒空数组）待 step3 连前端分支一起清
