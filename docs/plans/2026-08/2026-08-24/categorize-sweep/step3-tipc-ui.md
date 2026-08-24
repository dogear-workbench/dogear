---
step: 3
title: 手动入口与 UI
status: done
---

## 目标
设置页提供「补挂漏网组」手动按钮；「立即重跑全部分类」改名「全量重置分类」并加确认与成本提示。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-sweep-trigger.md] `triggerCategorizeSweep(wsId): Promise<{ disabled, pending, noTags }>`
- 当前关键文件状态：
  - `tipc/category.ts:46-90` 已有 `triggerCategorize` / `triggerFullRebuild` / `triggerCategorizeOrganize` 三个 RPC，新增的照同款结构（try/catch + console.error + 返回值透传）
  - `stores/smart-category-store.ts` 已有 `triggerFullRebuild` action（plan.md 全局决策提到）；sweep action 照抄结构
  - `SmartCategoryPanel.tsx` 按钮区在文件后半部（约 81 行起），「立即重跑全部分类」按钮调 `triggerFullRebuild`；面板已有 toast/加载态惯例
- 关键决策回顾：full-rebuild 是破坏性长任务（清空重扫全部组卡，10-30 分钟），改名后**必须**走 `confirm-store.ts` 的 `showConfirm()`（红线：禁 window.confirm）；sweep 是幂等轻操作，直接执行 + toast 结果即可

## 计划改动
- [ ] `tipc/category.ts` 加 `triggerCategorizeSweep` RPC：入参 `{ workspaceId }`，返回 `{ disabled, pending, noTags, error? }`
- [ ] `stores/smart-category-store.ts` 加 `sweep` action（调 RPC）
- [ ] `SmartCategoryPanel.tsx`：
  - 新按钮「补挂漏网组」→ sweep → toast 三分支：`已入队补挂 N 组` / `差集为空，无需补挂` / `智能分类已禁用`；若 noTags>0 追加 `（M 组组卡缺 tags，需重提炼）`
  - 「立即重跑全部分类」→ 文案改「全量重置分类」，点击先 `showConfirm({ title: '全量重置分类', description: '清空现有智能分类并重新决策全部组卡（当前工作区 N 组，约 10-30 分钟）。通常只需在分类混乱时使用，日常补漏请用「补挂漏网组」。' })`，确认后才触发
  - 两个按钮并排放在原 full-rebuild 按钮位置，sweep 为主按钮样式、full-rebuild 为次要（destructive/outline）
- [ ] `bun run build:electron` + `bun run dev:renderer` 验证按钮渲染与 toast

## 验证
- 设置页点「补挂漏网组」：差集 0 → toast `差集为空`
- 点「全量重置分类」：先弹确认框，取消不触发，确认后分类活动面板出现 full-rebuild 运行记录

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - step 文档「依赖上下文」过时：f484254（8-18）已把 full-rebuild 按钮/模型选择/提示词/活动区从 SmartCategoryPanel 删除；本 step 按「计划改动」段与主会话派遣决策重新引入两个按钮（相当于部分回退 f484254 的入口收敛，仅限分类补挂场景）
  - 新增改动 `app/settings/page.tsx:627` 介绍文案：step2 交接棒明确移交给 step3，且新增按钮后原「全量重跑在『定时计划』中运行」描述与本面板矛盾
  - full-rebuild 按钮样式选 outline（任务描述「destructive/outline」二选一）：破坏性由 confirm 弹窗的 destructive 确认钮承担，按钮本体保持次要视觉
  - full-rebuild 确认后补了一个 `toast.success('已开始全量重置分类')`（原实现无反馈，计划未列）
- 改动文件清单：
  - `electron/main/tipc/category.ts`：新增 `triggerCategorizeSweep` RPC
  - `stores/smart-category-store.ts`：新增 `CategorizeSweepResult` 类型 + `sweep` action
  - `app/settings/memory/SmartCategoryPanel.tsx`：两个按钮 + handleSweep/handleRebuild + 介绍文案
  - `app/settings/page.tsx`：智能分类 Tab 介绍文案

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - RPC `triggerCategorizeSweep({ workspaceId })` → `{ disabled, pending, noTags } | { error }`
  - store `sweep(workspaceId): Promise<CategorizeSweepResult | null>`（null = RPC 失败）
- 待办或已知限制：
  - 运行时手验（按钮/toast/确认框）需 app 内做，归主会话验证清单
  - 确认框组数取 `client.listGroups`（active 口径，与 full-rebuild 重扫范围一致）
