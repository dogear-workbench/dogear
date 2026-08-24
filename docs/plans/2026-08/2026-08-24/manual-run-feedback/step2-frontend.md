---
step: 2
title: 前端侧——删按钮/监听/模型提示
status: done
---

## 目标
删面板补分类按钮及其 RPC/store 残留；全局监听 manualTaskDone → toast；确认弹窗与重新提炼提示注明模型；介绍文案收口。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-backend.md] `manualTaskDone` 事件已广播（payload 见其实施回填），run-history manual 记录已写入
- 当前关键文件状态：
  - `SmartCategoryPanel.tsx`：`handleSweep`（84 行起）/ sweeping 状态（48）/ 按钮区（162-177 两个按钮）/ `handleRebuild`（106-117，showConfirm 确认弹窗）/ 介绍文案（128 附近「漏网组可在此补挂」待改）
  - `stores/smart-category-store.ts`：`CategorizeSweepResult`（5-8）/ `sweep` action（62-73）/ 模块级事件监听注册模式（115-126，rendererEvents.listen 惯例）
  - `tipc/category.ts:72-83` `triggerCategorizeSweep` RPC（删按钮后无消费者）
  - `DigestsPanel.tsx:80-89` `handleReDigest`（confirm 提示「该组将在后台重新提炼，列表会自动刷新。」）
  - 模型名读取：`client.getDigestModelSelection` / `client.getCategorizeModelSelection`（返回 `{ selection }`）；显示格式对照 `BuiltinTaskDetailSection.tsx` 的模型展示（MODEL_IO 映射 14-22 行附近及其渲染逻辑）
  - `app/settings/page.tsx:627` 附近智能分类 Tab 介绍文案
- 关键决策回顾：主进程 `triggerCategorizeSweep` 函数与 `collectSweepTargets` **保留**；只删前端入口链（按钮/action/RPC）。模型回退链：分类 → categorizeModelSelection ?? defaultModelSelection；提炼 → digestModelSelection ?? defaultModelSelection。全量重置按钮保留。

## 计划改动
- [ ] `SmartCategoryPanel.tsx`：删「补挂漏网组」按钮 + handleSweep + sweeping；「全量重置分类」确认弹窗 description 追加 `将使用模型 X（可在 定时计划 → 补分类 → 详情 中修改）`（X 按 selection 拼友好名，未指定时用默认模型名）；介绍文案改（不再提「漏网组可在此补挂」，补分类入口指向定时计划）
- [ ] `stores/smart-category-store.ts`：删 `sweep` action 与 `CategorizeSweepResult`
- [ ] `tipc/category.ts`：删 `triggerCategorizeSweep` RPC 与对应 import
- [ ] 全局 `manualTaskDone` 监听 → toast：挂载位置选 app 级必经模块（对照 smart-category-store.ts:115-126 的模块级 listen 惯例；sonner `toast.success` / `toast.error`，成功文案 `全量重置分类完成，耗时 X 分钟` / `<组名> 重新提炼完成`，按 payload.status 分流，cancelled 静默或 info）
- [ ] `DigestsPanel.tsx`：重新提炼 confirm 提示追加 `使用模型 X（可在 定时计划 → 组卡提炼 → 详情 中修改）`
- [ ] `app/settings/page.tsx`：Tab 介绍文案同步（补分类入口=定时计划）
- [ ] `bun run build:electron` + `bun run lint` 通过；`bun run dev:renderer` 验证面板渲染

## 验证
- 设置页面板：无补分类按钮，仅「全量重置分类」；点击弹确认含模型名
- 点重新提炼：提示含模型名；跑完出现全局 toast；run-history 有记录
- 取消全量重置：无成功 toast，历史记 cancelled

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 模型友好名解析拍平到 `lib/model-selection.ts` 的 `resolveModelLabel`（对照 ModelSelector 现有逻辑），`components/ModelSelector.tsx` 改为复用该函数（删私有副本），避免两处重复实现同一解析
  - 监听挂载在新建 `lib/manual-task-toasts.ts`（导出 `setupManualTaskToasts`），由 `src/main.tsx` 模块顶层调用——app 级必经且只执行一次，不受 StrictMode 双渲染影响；`formatDurationMs` 也在此文件导出（渲染层无既有实现，逻辑同主进程 delegation-terminal）
  - 成功 toast 主行 `planName + 完成，耗时 X`，summary 放 description（避免耗时重复出现，同时保留 no-card「未产出组卡」信息）；cancelled 用轻 `toast.info(planName 已取消)`；failed `toast.error(planName 失败, description: error)`
  - 顺带同步了 `app/settings/page.tsx` 定时计划 Tab 介绍里的「智能分类（补挂）」→「补分类」（step1 已改 builtin label，此处文案漏同步，且「补挂」术语禁现于 UI）
  - 分类与提炼的模型回退均按 selection ?? defaultModelSelection，两者均空时显示「默认模型（未设置）」
- 改动文件清单：`app/settings/memory/SmartCategoryPanel.tsx`（删 sweep 按钮/handleSweep/sweeping，确认弹窗加模型名，介绍文案收口）；`stores/smart-category-store.ts`（删 sweep action + CategorizeSweepResult）；`electron/main/tipc/category.ts`（删 triggerCategorizeSweep RPC + import）；`lib/manual-task-toasts.ts`（新文件：manualTaskDone 全局监听 → toast + formatDurationMs）；`src/main.tsx`（挂载 setupManualTaskToasts）；`app/settings/memory/DigestsPanel.tsx`（重新提炼提示加模型名）；`app/settings/page.tsx`（两处 Tab 介绍文案）；`lib/model-selection.ts`（+resolveModelLabel）；`components/ModelSelector.tsx`（复用 resolveModelLabel）

### 给下一步的接力棒
- 关键签名 / 数据结构：`resolveModelLabel(settings: AppSettings, selection: ModelSelection): string`（lib/model-selection.ts）；`setupManualTaskToasts()`（lib/manual-task-toasts.ts，main.tsx 已挂载）；toast 分流：completed→success（主行含耗时，summary 进 description）/ failed→error（error 进 description）/ cancelled→info
- 待办或已知限制：需重启应用人工验证 toast 与确认弹窗模型名；`electron/main/tipc/digest.ts`、`electron/main/tipc/renderer-handlers.ts` 的 step1 改动在 commit 9883758 之后仍留在工作区未提交（stash 验证时确认是 step1 必需），本次提交需一并带上
