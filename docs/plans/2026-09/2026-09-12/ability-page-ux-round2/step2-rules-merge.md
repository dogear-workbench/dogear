---
step: 2
title: 首页与规则编辑重构
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
