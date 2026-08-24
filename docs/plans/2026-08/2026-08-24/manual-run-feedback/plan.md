# 手动触发反馈与术语修正（manual-run-feedback）实施计划

**目标**：术语统一「补分类」+ 删面板补分类按钮；手动触发的全量重置/重新提炼写入运行历史并 toast 完成通知；确认弹窗与提示文案注明所用模型与修改入口。

**架构思路**：job 加 `source: 'manual'` 标记区分手动/定时入口，完成点仅对 manual 写 run-history + 广播完成事件（RendererHandlers 惯例）；模型提示纯文案拼接不新增 UI。排除了「恢复面板活动区/模型下拉」——8-18 刚做过入口收敛不回退。

**涉及模块**：`builtin-task-meta.ts` / `task-executor.ts` / `category-trigger.ts` / `group-digest-trigger.ts` / `tipc/category.ts` / `tipc/digest.ts` / `tipc/renderer-handlers.ts` / `run-history-store.ts`（复用）/ `stores/smart-category-store.ts` / `SmartCategoryPanel.tsx` / `DigestsPanel.tsx` / `app/settings/page.tsx`

**设计文档**：[./design.md](./design.md)

## 步骤索引

- [x] [Step 1: 主进程侧——改名/历史/事件](./step1-backend.md) — label「补分类」+ summary 人话 + job source 标记 + 完成点写 run-history + 广播 manualTaskDone
- [ ] [Step 2: 前端侧——删按钮/监听/模型提示](./step2-frontend.md) — 删面板按钮与 sweep RPC/store action + 全局监听 toast + 弹窗/提示模型名 + 介绍文案

## 全局决策

- **术语**：UI 可见面只出现「补分类」；「补挂」「差集」禁止出现。label 直接叫「补分类」（与「组卡提炼/复盘报告/分类整理」对仗，避免「智能分类（补分类）」重复）
- **job source 标记**：`CategorizeJob` / `GroupDigestJob` 加可选 `source?: 'manual'`；仅手动 RPC 入口（`triggerFullRebuild` / `triggerGroupDigest`）传，scanAll/链式/会话关闭入口不传；完成点 `source === 'manual'` 才写历史+广播——否则定时扫描的单组 job 会重复记历史
- **run-history 伪 planId**：`manual-full-rebuild`（planName「全量重置分类」）/ `manual-redigest`（planName「重新提炼：<组标题>」）；`triggerReason: 'manual'`，含 startedAt/endedAt/durationMs 于 summary
- **完成事件**：走 RendererHandlers 惯例——接口加 `manualTaskDone`，主进程 `getRendererHandlers(...).manualTaskDone.send(payload)`，渲染层 `rendererEvents.manualTaskDone.listen(...)`（@/lib/events，对照 stores/smart-category-store.ts:116-126 注册模式）
- **历史写入失败只 mainLogger.warn**，不影响任务；事件在无窗口时自然丢弃
- **失败/取消也写历史**（status: 'failed' / 'cancelled' + error），取消不 toast 成功
- **模型回退链**：分类 → `categorizeModelSelection` ?? `defaultModelSelection`；提炼 → `digestModelSelection` ?? `defaultModelSelection`；显示格式对照 BuiltinTaskDetailSection 现有逻辑
- **删除物清单**（step2）：面板 sweep 按钮/handleSweep/sweeping、store `sweep` action 与 `CategorizeSweepResult`、tipc `triggerCategorizeSweep` RPC；**主进程 `triggerCategorizeSweep` 函数与 `collectSweepTargets` 保留**（task-executor 消费）
