---
step: 2
title: 首页与规则编辑重构
status: done
---

## 目标

规则入口收口到能力页：首页合并卡 + 合并详情页 + RuleFileEditor 单栏渲染/编辑态切换 + 移除主界面顶部 WorkspaceRuleDialog 入口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-backend-ownership.md] 的实施回填（如注册表结构有变）
- 关键现状：
  - `app/settings/AbilityTab.tsx`：`packs.map` 渲染 `AbilityPackCard`（约 200 行），`selectedKey` state 路由到 `AbilityPackDetailPage`
  - `app/settings/ability/RuleFileEditor.tsx`：`grid grid-cols-2` 编辑+预览两列（约 90 行）
  - WorkspaceRuleDialog 入口：主界面顶部按钮（Grep `WorkspaceRuleDialog` 定位，上一轮重构后详情确认同读写 RPC；本步删除按钮与组件引用）
- 关键决策回顾：注册表两个 key（workspace-rules / global-rules）不变，合并纯展示层；首页合并卡不带总开关（无单一开关语义），两条规则状态以徽标展示

## 计划改动

- [ ] `app/settings/AbilityTab.tsx`：packs 渲染时过滤 `global-rules`，`workspace-rules` 渲染为合并卡（新组件 `ability/RulesPackCard.tsx`：标题「规则」+ 工作区/全局两条规则的启用状态徽标，onOpen 进合并详情）；`selectedKey === 'workspace-rules' || 'global-rules'` 均路由到合并详情组件
- [ ] 新组件 `app/settings/ability/RulesPackDetailPage.tsx`：左侧两个 `RuleFileEditor`（工作区 agent.md、全局 agent.md，各自独立编辑），右侧栏两条规则各自的包开关（复用 `handleTogglePack`）+ 两段 `AbilityMountsSection`（分别传两个包 key）
- [ ] `app/settings/ability/RuleFileEditor.tsx` 改单栏态切换：
  - 平时渲染态：`MarkdownRenderer`（空内容显示 emptyHint 引导 + 「编辑」按钮）
  - 点「编辑」进入编辑态：单个 `Textarea` 占满 + 保存 / 恢复模板 / 取消（放弃修改回渲染态）+ 未保存标记
  - 保存成功后自动回渲染态；字号用标准档位（text-sm 正文，text-xs 辅助）
- [ ] 主界面顶部：移除工作区规则按钮（定位 WorkspaceRuleDialog 消费方，删按钮与 import；如组件无其他消费方一并删除组件文件）
- [ ] 验证：`bunx tsc --noEmit` + `bun run lint` + dev 起页面人工核对（合并卡状态徽标随开关变化、两条规则编辑互不干扰、保存后渲染态刷新）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 连带清理 AbilityPackDetailPage.tsx：workspace-rules / global-rules 两个 RuleFileEditor 分支及空段提示条件中的对应排除项成为死代码（AbilityTab 拦截后不再命中），一并删除，RuleFileEditor import 随之移除。
  - RulesPackCard 徽标配色：启用用 emerald、关闭用 amber（对齐 AbilityMountsSection / AbilityPackCard 的语义色习惯），无总开关、不可直接切换，只能点击进详情。
  - RuleFileEditor 渲染态显示的是当前已保存内容；空内容时主体显示 emptyHint 引导文案（编辑按钮常驻标题行）。
- 改动文件清单：
  - app/settings/ability/RulesPackCard.tsx（新建）：合并卡，标题「规则」+ 工作区/全局两条规则启用徽标，onOpen 进合并详情
  - app/settings/ability/RulesPackDetailPage.tsx（新建）：左侧两个独立 RuleFileEditor（工作区/全局 agent.md）+ 右侧栏两个包开关（onTogglePack('workspace-rules'|'global-rules')，复用 AbilityTab.handleTogglePack）+ 两段 AbilityMountsSection（configVersion 作 refreshKey）；无工作区时工作区编辑区提示、双开关禁用
  - app/settings/ability/RuleFileEditor.tsx：重写为单栏态切换——渲染态（MarkdownRenderer，正文 text-sm；空内容显示 emptyHint）+「编辑」按钮 → 编辑态（Textarea 占满 + 恢复模板/取消/保存 + 未保存标记）；保存成功自动回渲染态，取消回滚到已保存内容
  - app/settings/AbilityTab.tsx：packs 拆出 rulesPack/globalRulesPack/otherPacks；selectedKey 为两规则 key 之一时路由 RulesPackDetailPage（在 selectedPack 查找前拦截）；首页渲染 RulesPackCard（置于卡片网格首位）+ otherPacks
  - app/settings/ability/AbilityPackDetailPage.tsx：删除两规则包死分支
  - app/page.tsx：移除 WorkspaceRuleDialog（import / state / 顶部按钮 / 组件渲染），ScrollText 图标 import 一并移除
  - components/WorkspaceRuleDialog.tsx：删除（唯一消费方是 app/page.tsx）
- 验证：bunx tsc --noEmit 通过；bun run lint 0 errors（87 warnings 全部既有 any，改动文件零警告）；dev 人工核对本环境无法执行，跳过（合并卡徽标随开关变化、两规则编辑互不干扰、保存后渲染态刷新待主会话冒烟确认）。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - RulesPackCard({ workspaceRulesEnabled, globalRulesEnabled, onOpen })
  - RulesPackDetailPage({ workspace, workspaceId, workspaceRulesEnabled, globalRulesEnabled, packBusy, configVersion, onBack, onTogglePack(key, enable) })；开关存储不变（workspace config abilityOverrides['workspace-rules'|'global-rules']）
  - RuleFileEditor props 未变（title / emptyHint / read / write / loadTemplate），新增内部 editing 态；两规则包不再进 AbilityPackDetailPage
- 下个 step 该从哪里继续：Step 3 详情页布局重划与系统行为三区（AbilityPackDetailPage 左主区 skill chips + 右窄栏瘦身、SystemBehaviorDetail 三区含常驻工具区、浮窗闪烁修复）；AbilityPackDetailPage 已无规则分支，直接在剩余结构上改。
- 待办或已知限制：
  - Step 4 需统一清理能力页残留固定像素字号（AbilityTab 系统行为卡 text-[10px]、AbilityPackCard/AbilityMountsSection/AbilityPackSidebar 等）；本次新建/重写文件已全部用标准档位
  - 合并卡徽标仅展示 abilityOverrides 计算后的开关状态；「规则」卡描述文案「注入每个会话」与注册表两条 description 摘要合并，如需精确引用注册表文案后续调整
