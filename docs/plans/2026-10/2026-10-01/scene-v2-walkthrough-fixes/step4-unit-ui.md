---
step: 4
title: 单元层 UI
status: done
---

## 目标
Profile 编辑器 browser 砍成单开关；定时任务编辑页新增「扩展能力（Skill）」选择区（step1 数据链的前端入口）。

## 依赖上下文（接力棒输入）
- 前置 step1 产出：task-types skillsOverride 字段 + plan-validate sanitize + custom-agent-task 拼接装配已通
- 关键现状（事实报告 H/E 节）：`SubAgentTab.tsx:100-116` setBrowserBlock 双通道联动（双关时开块=双开/关块=双清）+「细选 · n/2」Popover 两个 ChannelSwitchItem；`TaskEditorPage.tsx:199-205` CustomToolPacksSection 挂载点；CustomToolPacksSection.tsx 的「跟随工作区/任务级覆盖」交互模式可参照
- Profile enabledAbilities 的 browser 块开关现值语义：块开=双通道 tools 齐开

## 计划改动
- [x] `SubAgentTab.tsx`：删 browser 细选 Popover 与 ChannelSwitchItem 渲染；块开关改为直写（开=双通道全开，关=全关），行为等价原 setBrowserBlock 但无细选入口；profile.enabledAbilities 残留双通道字段不清理
- [x] 新组件（TaskEditorPage 同目录）：Skill 挂载选择区——列可选 skill（builtin 包内 skill + 自定义 skill，口径见 design 未决问题，实施时按 skill 索引 API 便捷度定并回填），Checkbox 多选写 `draft.skillsOverride`（全不选=undefined 跟随「不挂载」）；未选任何项时徽标「不挂载」
- [x] `TaskEditorPage.tsx`：在 CustomToolPacksSection 下方挂载新组件，透传 draft 与 onChange
- [x] tipc：复用既有 `listSkills` 路由（tipc/skill.ts，三目录源与装配侧同源），无需新增路由
- [x] 验证：`npx tsc --noEmit -p tsconfig.json`；目验 Profile 编辑器 browser 单开关、定时任务编辑页 skill 选择与保存回显

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. tipc 路由未新增：`listSkills` 路由已存在（tipc/skill.ts，返回三目录全量 + source 标注），直接复用，未动主进程（无需 build:electron）
  2. 候选口径定为「全部三源（builtin + custom + user）」：与装配侧 loadAllSkillEntries 同源，勾选必过 sanitize；非 builtin 来源加「自定义」徽标
  3. 前端 `types/scheduler.ts` 补 `CustomScheduledTask.skillsOverride` 字段（计划隐含必需，前端类型此前没有）
  4. AbilityBlockRow.tsx 删 ChannelSwitchItem 组件（唯一消费者消失，不留半成品）
  5. setBrowserBlock 从「双关时开块=双开/已开任一通道不动/关块=双清」简化为直写双字段：无细选入口后「已开任一通道不动」分支不可达，简化后行为等价
- 改动文件清单：
  - `app/settings/SubAgentTab.tsx`：browser 块删细选 Popover 与 detailCount，单开关直写 browser+extension 双字段；描述追加「内嵌与扩展两个通道随开关一起开或一起关」
  - `app/settings/subagent/AbilityBlockRow.tsx`：删 ChannelSwitchItem（interface + 组件）
  - `app/data-center/scheduler/CustomSkillsSection.tsx`（新）：Skill 挂载多选区，取数 client.listSkills({})，Checkbox 多选写 skillsOverride（空→undefined），未选时徽标「不挂载」
  - `app/data-center/scheduler/TaskEditorPage.tsx`：CustomToolPacksSection 下方挂载 CustomSkillsSection（不受 workspaceId gate——skillsOverride 任务级与工作区无关）
  - `types/scheduler.ts`：CustomScheduledTask 加 skillsOverride?: string[]

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `CustomSkillsSection({ selected, onChange })`：selected=draft.skillsOverride；onChange 空选集时回调 undefined
  - 候选清单 = `client.listSkills({}).skills`（SkillEntry{source,name,description,dir,filePath,enabled}，enabled 未用）
- 下个 step 该从哪里继续：走查修正计划 step5（如有）；验证阶段重点目验本 step 人工清单
- 待办或已知限制：
  - listSkills 是一层目录扫描，pi loadSkills 递归索引中的嵌套 skill 不会出现在候选（勾不到但装配允许，无反向问题）；sanitize 兜底过滤，保存不阻断
  - skill-service 与 pi loadSkills 的 name 校验宽度有差异：极端情况勾选的名在保存时被 sanitize 静默滤掉，回显消失（可接受）
