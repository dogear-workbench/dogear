---
step: 2
title: scheduler 接线
status: done
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
  1. **新增 plan-store.ts name 同步迁移（计划外必要）**：plan-validate.ts:81 校验 builtin 任务 `name !== BUILTIN_LABELS[builtinId]` 即拒保存，改 label 后旧 plans.json 无法编辑保存；ensureStoreReady 加载时同步 name 到最新 label 并写回，幂等
  2. 拆开 categorize / categorize_organize 共享 case，工作区解析提取 `resolveTaskWorkspaces` helper 两 case 复用；organize 行为零变化
  3. app/ 下无 categorize 专属任务描述文案（BuiltinTaskDetailSection 只有模型/prompt 编辑），只同步 page.tsx:638 列举；「补挂漏网组…」完整描述无落点未使用
- 改动文件清单：`task-executor.ts`（categorize 分支切 sweep + waitForQueueIdle + 三态 summary）、`builtin-task-meta.ts`（label 改「智能分类（补挂）」，prompt 三件套/tools 未动）、`plan-store.ts`（+8 行 name 同步）、`app/settings/page.tsx:638`（列举文案）、types/scheduler.ts 检查无需改
- 验证：build:electron 通过；lint 0 errors（74 warnings 存量）；engine 单测全过。运行时手验（差集空秒回/移组计 1）待 app 内验证

### 给下一步的接力棒
- 关键签名 / 数据结构：scheduler 执行 categorize = 每工作区 `triggerCategorizeSweep` → `waitForQueueIdle` → 三态 summary（全部 disabled →「智能分类已禁用，跳过」/ X=0 且 Y=0 →「差集为空，无需补挂」/ 否则「已补挂 X 组，Y 组缺 tags 需重提炼」）；取消路径 cancelAllCategorize 与 sweep 入队的 incremental job 兼容
- 下个 step 该从哪里继续：`tipc/category.ts:46-90` 三个 trigger RPC 区域（sweep RPC 照同款结构）
- 待办或已知限制：
  - 设置页「智能分类」Tab 介绍段（page.tsx:627 附近）语义文案未动，归 step3
  - sweep 是全局开关（不分工作区），未来按工作区开关需 revisit
