---
step: 3
title: ProfileEditor 能力域块化
status: done
---

## 目标

ProfileEditor 能力域区按能力页包结构分块渲染：块 = 总开关，块内多细项点「细选」弹 Popover 勾选；补 stock skill 盲点；数据源换 getAbilityPacks 单一真源。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 已重写 browser-parse description（编辑器里该 Profile 的描述展示随之更新）
- 现状：`app/settings/SubAgentTab.tsx` ProfileEditor（约 :95-300）能力域区 = `BOOLEAN_ABILITIES` 6 个扁平 checkbox + `codeWorkflowSkills`（`CODE_WORKFLOW_TEMPLATES` 硬编码过滤）+ `customSkillList` 两组列表
- 数据源：`client.getAbilityPacks()` 返回 `{ packs: AbilityPackView[], ... }`，`AbilityPackView.skillMetas[].name` 是包内 skill 权威清单；自定义 skill 仍走挂载时 `client.getSkills()` 解析（source user/custom 且不在 templates 内）
- 写回目标结构（**不变**）：`ab.memory/stock/article/browser/extension/web`（布尔）+ `ab.skills`（数组，混装各包 skill 名）+ `ab.customSkills`（数组）
- 全局决策回顾：细项勾选独立于总开关保存（关域不清细项）；browser 块开 = 双 false 双置 true、关 = 双清；code-workflow / 自定义块以数组非空为开；块过滤只取本包 skillMetas 内的名字，skills 数组里其他域的值保存时原样保留

## 计划改动

- [x] `app/settings/SubAgentTab.tsx`：SubAgentTab 挂载时加 `client.getAbilityPacks()` 拉取（失败 toast 提示重试，不降级双 UI），packs 下传 ProfileEditor
- [x] 新组件 `app/settings/subagent/AbilityBlockRow.tsx`：单块行 = 包图标 + 名称 + 描述 + 右侧 Switch 总开关 + 有细项时「细选 · n/m」按钮弹 Popover
- [x] 块渲染映射（pack key → 主开关字段 / 浮窗细项）：memory/article/web-mcp 单 Switch；stock Switch + 2 skill checkbox；browser 开 = 双 false 双置 true、关 = 双清 + 2 通道 Switch；code-workflow / 自定义 Skill 数组非空为开、开时空则默认全勾
- [x] 退役 `CODE_WORKFLOW_TEMPLATES` 常量与 `BOOLEAN_ABILITIES` 数组；保留「交付通信」固定行与交集语义说明文案
- [x] 交付通信 / prompt-only 包不进块映射（交付通信保留固定行展示，无写回）
- [x] 代码推演验证勾选组合（browser 联动、关域重开细项保留、存量混入保留、browser-parse 初始态）；Electron UI 目视留给 step4
- [x] `bun run lint` + `bunx tsc -p tsconfig.json --noEmit` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 交付通信两条条目取兼容解读：不进块映射（无写回）但保留固定行（视觉统一为块行样式 + disabled Switch）
  - 细选按钮带 n/m 计数（轻量 UI 增补）
  - 块描述用 pack.description（单一真源）替代原手写描述；browser 双通道细项描述沿用手写文案
  - UI 目视无法在本环境执行，改为代码推演覆盖全部勾选组合，UI 目视清单留给 step4
- 改动文件清单：`app/settings/SubAgentTab.tsx`（重构，441→约 510 行）、新增 `app/settings/subagent/AbilityBlockRow.tsx`（AbilityBlockRow / SkillCheckItem / ChannelSwitchItem）

### 给下一步的接力棒
- 关键签名 / 数据结构：`AbilityBlockRow({ icon, title, description, checked, onCheckedChange, detailCount?, details? })`；`SINGLE_FIELD_BY_PACK`（web-mcp→ab.web）、`NON_PROFILE_PACK_KEYS`（notes/group-context/agent-collab）两映射在 SubAgentTab.tsx 顶部；`writeArrayField(field, names, on)` 只增删给定名字，存量混入 skill 永不清除
- 下个 step 该从哪里继续：step4 联调验证（browser-parse 块初始态、勾选组合保存重开一致、getAbilityPacks 失败重试路径）+ codebase-map 同步 + 完成总结
- 待办或已知限制：① browser 块中间态缝隙（既有）：resolveAbilities 子会话只认 ab.browser，细选仅开扩展时块 Switch 显示 on 但包不生效——设计拍板语义 + 数据层冻结下维持现状，是否加 UI 提示待用户裁决；② 列表卡片「能力域 N」计数仍是旧口径（browser/extension 分开计、skills 整算 1）；③ SubAgentTab 约 510 行（超 300 线），ProfileEditor 主函数约 220 行，是否进一步拆分待后续；④ UI 目视验证清单见共享区 subagent-profile-ability-blocks/step3-delivery.md
