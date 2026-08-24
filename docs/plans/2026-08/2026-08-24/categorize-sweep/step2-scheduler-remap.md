---
step: 2
title: scheduler 接线
status: pending
---

## 目标
scheduler 的 categorize builtin 从 `triggerFullRebuild` 切到 `triggerCategorizeSweep`，meta 文案同步为补漏语义。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-sweep-trigger.md] `triggerCategorizeSweep(workspaceId): Promise<{ disabled, pending, noTags }>`，行为：差集逐组入队 incremental，秒级返回（不等队列跑完）
- 当前关键文件状态：
  - `task-executor.ts:83-89` categorize 分支现状：无 workspaceId 时 `getAllWorkspaces()` 循环，`builtinId === 'categorize'` → `triggerFullRebuild(ws.id)`，最后 `waitForQueueIdle` 轮询队列空才返回
  - `builtin-task-meta.ts:42` `categorize: '智能分类'`；meta 结构含 loadPrompt/savePrompt/defaultPrompt/tools（categorize 的 prompt 三件套**保持不动**，增量决策提示词仍被 incremental 复用）
- 关键决策回顾：builtinId `'categorize'` 不改（plans.json 兼容）；返回值秒回但**仍要 `waitForQueueIdle`**——任务链语义是「这轮分类跑完才算完成」，且 run-history 需要真实结束时间；waitForQueueIdle 已有（`getCategorizeActivity().current === null && queueDepth === 0`）

## 计划改动
- [ ] `task-executor.ts:87`：`await triggerFullRebuild(ws.id)` → 改为收集每工作区 sweep 结果；summary 拼接：全部 disabled → `智能分类已禁用，跳过`；否则 `已补挂 X 组，Y 组缺 tags 需重提炼`（X 为各工作区 pending 之和，Y 为 noTags 之和；X=0 且 Y=0 → `差集为空，无需补挂`）
- [ ] `builtin-task-meta.ts`：categorize label 改 `'智能分类（补挂）'`；若该文件或前端定时任务 UI 有任务描述文案（搜 `categorize` 在 `app/` 下的展示），同步为「补挂漏网组：给有组卡但未进任何分类的话题补做归类决策，幂等，断点自动续」
- [ ] 前端类型镜像 `types/scheduler.ts` 如有 builtinId/label 枚举同步检查
- [ ] `bun run build:electron` 通过

## 验证
- 定时任务页手动运行「智能分类（补挂）」：当前三工作区差集应为 0（昨天 full-rebuild 刚全量挂过 59/61）→ run-history 出现 `差集为空，无需补挂`，秒级完成
- 临时把某组移出分类（或造一张新组卡不入队）再手动运行 → 该组入队、走 Step A/LLM、挂载、run-history 计 1

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：`tipc/category.ts:46-90` 三个 trigger RPC 区域
- 待办或已知限制：
