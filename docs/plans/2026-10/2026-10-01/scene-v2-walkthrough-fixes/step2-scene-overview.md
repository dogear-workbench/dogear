---
step: 2
title: buildSceneOverview 重构
status: pending
---

## 目标
六行数据结构按 design.md §2/§3 修正，subToggles 只留 code-workflow，徽标死代码清理，全部行 description 与格子 reason 换新文案。

## 依赖上下文（接力棒输入）
- 前置 step1 产出：定时任务 skillsOverride 链路已通（本步定时任务行文案提到「工具包与 skill」即有实指）
- 关键现状（事实报告 A/B/G 节，文件 `electron/main/tipc/ability-scene.ts`）：mainCell:472（subToggles 生成）、personalCell:491 + PERSONAL_EXCLUDED_KEYS:460 + personalSceneReason:116、subCell:525（subAutonomous excluded + code-workflow switchable）、schedulerCustomCell:595 + schedulerCustomAgentCell/schedulerPackHitCell:154-202（loaded 计算）、六行 description:660-716
- 配套：`SceneTab.tsx:22-27` statusBadge 的 excluded&&loaded 分支（本步只删数据侧 loaded 传递，前端分支留 step3 一起删）

## 计划改动
- [ ] `mainCell`/`personalCell`：subToggles 仅 code-workflow 生成（`pack.key === 'code-workflow' && pack.type === 'skill-packs'`），其余 skill-packs 不带 subToggles
- [ ] `personalCell`：删 workspace-rules 格子；PERSONAL_EXCLUDED_KEYS 相关包不再逐格输出，改为行级一句说明（文案见 design §2/§7）；global-rules 与扩展包保留
- [ ] `subCell`：扩展分组五包全部不再输出格子，改为分组级 note 字段「扩展能力（股票/文章/浏览器/联网/代码 skill）在派遣页按 Profile 勾选」；固定层格子与 sceneOverrides.sub 开关不变
- [ ] `schedulerCustomCell`：扩展分组五包撤格子换分组级 note「扩展工具包与 skill 在定时任务编辑页按任务配置」；__scheduler-base__ 强制格与 memory/notes 开关保留；删除 schedulerCustomAgentCell/schedulerPackHitCell 的 loaded 命中计算
- [ ] `profileFilterReason`：删 memory 残留分支（装配侧已不查 Profile memory 闸）
- [ ] 六行 description + 全部 reason 按新文案基准重写（design §7 基调：一句话、说人话）；恢复默认 confirm 文案同步
- [ ] 行数据结构如需加 `groupNote` 字段（分组级说明），同步 tipc 类型定义
- [ ] 验证：`bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
