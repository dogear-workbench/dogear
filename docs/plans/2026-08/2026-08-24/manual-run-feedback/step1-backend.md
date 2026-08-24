---
step: 1
title: 主进程侧——改名/历史/事件
status: in_progress
---

## 目标
label 改「补分类」+ summary 人话；job 加 manual 标记；全量重置/重新提炼完成点写 run-history 并广播完成事件。

## 依赖上下文（接力棒输入）
- 设计：[../design.md](../design.md)
- 当前关键文件状态：
  - `builtin-task-meta.ts:42` 附近 `BUILTIN_LABELS.categorize: '智能分类（补挂）'`
  - `task-executor.ts:93-109` categorize 分支 summary 三态（「差集为空，无需补挂」/「已补挂 X 组…」两处待改，「智能分类已禁用，跳过」不变）
  - `category-trigger.ts:14` `CategorizeJob` kind 联合（incremental / full-rebuild / organize）；`:174-200` runOne 完成点（已有 outcome + categoriesUpdated 广播惯例可对照）；`:212` triggerCategorize；`:275` 附近 triggerFullRebuild（enqueue full-rebuild job）
  - `group-digest-trigger.ts`：GroupDigestJob 类型 + 单组 job 完成回调结构对照 runOne；`triggerScanAll` 是定时批量入口、单组入口函数需现场定位（tipc `triggerGroupDigest` 调用它）；链式/会话关闭入口同文件
  - `tipc/digest.ts:59` `triggerGroupDigest` RPC（手动重新提炼的唯一前端入口）；`tipc/category.ts` `triggerFullRebuild` RPC（手动全量重置唯一入口）
  - `run-history-store.ts:26` `appendHistoryEntry(entry: RunHistoryEntry)` 直接可用
  - `types/scheduler.ts:84-96` `RunHistoryEntry` 字段：id/ts/planId/planName/status/triggerReason/triggerDesc?/startedAt?/endedAt?/summary?/error?/tokens?
  - `tipc/renderer-handlers.ts:190` 附近 `RendererHandlers` 接口（categoriesUpdated 定义处，新事件照加）
- 关键决策回顾：job 加 `source?: 'manual'` 只在手动 RPC 入口传；完成点仅 manual 写历史+广播；伪 planId `manual-full-rebuild` / `manual-redigest`；失败/取消也写（cancelled 不广播成功 toast，事件 payload 带 status 让渲染层分流）

## 计划改动
- [ ] `builtin-task-meta.ts`：`categorize` label → `'补分类'`（plan-store 的 name 同步迁移已有，无需额外处理）
- [ ] `task-executor.ts`：summary 改 `已为 X 个话题补分类，Y 个话题缺标签需重新提炼` / `没有未分类的话题`
- [ ] `category-trigger.ts`：`CategorizeJob` 加 `source?: 'manual'`；`triggerFullRebuild` 签名加参数并由 tipc 传 `'manual'`；runOne 完成点在 `job.kind === 'full-rebuild' && job.source === 'manual'` 时 `appendHistoryEntry`（planName `全量重置分类`，status 按 outcome/cancelled 映射，summary 含组数与耗时）+ 广播 `manualTaskDone`（payload 至少含 kind/planName/status/durationMs）
- [ ] `group-digest-trigger.ts`：单组 job 类型加 `source?: 'manual'`；手动入口函数（tipc triggerGroupDigest 调用链上）传 `'manual'`；单组完成点同理写历史（planName `重新提炼：<组标题>`，组标题从 job 或组卡取，取不到用 groupId 短码）+ 广播
- [ ] `tipc/renderer-handlers.ts`：`RendererHandlers` 加 `manualTaskDone` 定义（payload 结构自己定，写进实施回填）
- [ ] `bun run build:electron` 通过

## 验证
- build 通过后（需重启应用）：设置页手动点「全量重置分类」→ 跑完 run-history 出现 `全量重置分类` manual 记录；DigestsPanel「重新提炼」某组 → 跑完出现 `重新提炼：<组名>` 记录
- 定时任务跑「补分类」→ **不**产生 manual 记录（source 区分生效）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名：`manualTaskDone` payload 结构（step2 渲染层监听要用）
- 下个 step 该从哪里继续：`SmartCategoryPanel.tsx` 按钮区（81 行起）
- 待办或已知限制：
