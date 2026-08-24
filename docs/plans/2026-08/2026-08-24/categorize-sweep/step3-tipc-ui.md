---
step: 3
title: 手动入口与 UI
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 待办或已知限制：
