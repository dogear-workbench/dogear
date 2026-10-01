---
step: 4
title: 单元层 UI
status: pending
---

## 目标
Profile 编辑器 browser 砍成单开关；定时任务编辑页新增「扩展能力（Skill）」选择区（step1 数据链的前端入口）。

## 依赖上下文（接力棒输入）
- 前置 step1 产出：task-types skillsOverride 字段 + plan-validate sanitize + custom-agent-task 拼接装配已通
- 关键现状（事实报告 H/E 节）：`SubAgentTab.tsx:100-116` setBrowserBlock 双通道联动（双关时开块=双开/关块=双清）+「细选 · n/2」Popover 两个 ChannelSwitchItem；`TaskEditorPage.tsx:199-205` CustomToolPacksSection 挂载点；CustomToolPacksSection.tsx 的「跟随工作区/任务级覆盖」交互模式可参照
- Profile enabledAbilities 的 browser 块开关现值语义：块开=双通道 tools 齐开

## 计划改动
- [ ] `SubAgentTab.tsx`：删 browser 细选 Popover 与 ChannelSwitchItem 渲染；块开关改为直写（开=双通道全开，关=全关），行为等价原 setBrowserBlock 但无细选入口；profile.enabledAbilities 残留双通道字段不清理
- [ ] 新组件（TaskEditorPage 同目录）：Skill 挂载选择区——列可选 skill（builtin 包内 skill + 自定义 skill，口径见 design 未决问题，实施时按 skill 索引 API 便捷度定并回填），Checkbox 多选写 `draft.skillsOverride`（全不选=undefined 跟随「不挂载」）；未选任何项时徽标「不挂载」
- [ ] `TaskEditorPage.tsx`：在 CustomToolPacksSection 下方挂载新组件，透传 draft 与 onChange
- [ ] tipc：如需暴露「skill 候选清单」只读路由（名称+一句话描述），在 ability.ts 或 scheduler 相关 tipc 加
- [ ] 验证：`npx tsc --noEmit -p tsconfig.json`；目验 Profile 编辑器 browser 单开关、定时任务编辑页 skill 选择与保存回显

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
