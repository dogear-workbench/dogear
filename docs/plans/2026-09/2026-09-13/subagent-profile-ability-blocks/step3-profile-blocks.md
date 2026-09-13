---
step: 3
title: ProfileEditor 能力域块化
status: pending
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

- [ ] `app/settings/SubAgentTab.tsx`：SubAgentTab 挂载时加 `client.getAbilityPacks()` 拉取（失败 toast 提示重试，不降级双 UI），packs 下传 ProfileEditor
- [ ] 新组件 `app/settings/subagent/AbilityBlockRow.tsx`（或就近文件内拆，>300 行则拆文件）：单块行 = 包图标（复用 `app/settings/ability/pack-meta.ts` 的图标选型）+ 名称 + 描述 + 右侧 Switch 总开关 + 有细项时「细选」按钮弹 Popover
- [ ] 块渲染映射（pack key → 主开关字段 / 浮窗细项）：
  - memory / article / web-mcp：单 Switch，无细选；article 块描述注明「article-parser skill 随开关直通」
  - stock：Switch 写 `ab.stock`；细选 Popover = 2 个 skill checkbox（stock-analysis / stock-picking，读写 `ab.skills`，只过滤本包 skillMetas 内名字）
  - browser：Switch = `ab.browser || ab.extension`（开时双 false → 双 true，关 → 双 false）；细选 Popover = 2 个通道 Switch（内嵌浏览器 `ab.browser` / 浏览器扩展 `ab.extension`）
  - code-workflow：Switch = 包内 skill 任一在 `ab.skills`（开时若空 → 默认全勾，关 → 清空本包 skill 名）；细选 Popover = 6 个 skill checkbox
  - 自定义 Skill（有 customSkillList 时）：同 code-workflow 语义，读写 `ab.customSkills`，细选 Popover = 自定义 skill checkbox
- [ ] 退役 `CODE_WORKFLOW_TEMPLATES` 常量与 `BOOLEAN_ABILITIES` 数组；保留「交付通信」固定行与交集语义说明文案（step1 已换词版本）
- [ ] 交付通信 / prompt-only 包不展示（维持现状语义：规则类按触发条件自动注入）
- [ ] 目视验证：新建 Profile 勾选组合（browser 双通道细选、stock skill 细选、关域重开细项保留）保存后重新打开一致；browser-parse 内置 Profile 显示 article 块已开
- [ ] `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
