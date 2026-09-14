---
step: 5
title: 执行历史 UI
status: done
---

## 目标
执行历史面板支持类型筛选、卡片带类型徽章、「正在运行」区显示全部四类任务。

## 依赖上下文（接力棒输入）
- 前置 step 产出：
  - step1：`types/scheduler.ts` 已有 `RunHistorySource`；`listRunHistory` IPC 已支持 `source?: string`
  - step2-4：三类新条目已入库，真实数据可验证
- 当前关键文件状态：
  - `app/data-center/history-panel.tsx` — 两个下拉：「按任务筛选」（定时任务列表，loadHistory(planId?)）+「按状态筛选」（前端过滤）；RunningSection 只显示 running（无类型）
  - `stores/scheduler-store.ts` — `loadHistory(planId?)` / `loadMoreHistory()` / `refreshActivity()`
  - `app/data-center/HistoryEntryCard.tsx` — 状态徽章 + planName + 触发方式徽章 + tokens；展开 error/summary
- 关键决策回顾：类型筛选走后端参数；任务名筛选下拉删除（被类型筛选取代）；状态筛选保留前端过滤；详情文案用「结果」不用「摘要」

## 计划改动
- [ ] `app/data-center/history-utils.ts` — 加 `SOURCE_META: Record<RunHistorySource, { label, badgeCls }>`（定时任务/状态抽取/文章解析/协作任务，四色区分）；读侧无 source 缺省 'scheduler' 的归一函数
- [ ] `stores/scheduler-store.ts` — `loadHistory` 签名改为接受 `{ source?: RunHistorySource }`（planId 筛选参数随任务筛选下拉一并删除）；分页游标逻辑不变
- [ ] `app/data-center/history-panel.tsx` — 「按任务筛选」下拉替换为「按类型筛选」（全部/四类，onValueChange 调 loadHistory({source})）；RunningSection 条目显示类型徽章 + 名称 + 已运行时长
- [ ] `app/data-center/HistoryEntryCard.tsx` — 标题行加类型徽章（SOURCE_META）；触发方式徽章仅 source='scheduler' 显示；空态文案微调（筛选无结果提示覆盖类型维度）
- [ ] 验证：四类任务各产生一条历史后，类型筛选切换正确、卡片徽章正确、运行中任务实时出现/消失；旧历史条目（无 source）归为定时任务显示
- [ ] `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。补充两点：① `SOURCE_META.scheduler` 采中性色（border-border/bg-muted）而非彩色，避免与 STATUS_META 的四色体系争用；② store 内 `historyTaskId` 改名 `historySource`（筛选维度从任务换成类型的自然结果）。
- 改动文件清单：
  - `app/data-center/history-utils.ts` — 加 `resolveSource()`（无 source 缺省 'scheduler'）与 `SOURCE_META`（四色：scheduler 中性 / state-extract violet / parse-article sky / collab-task pink）
  - `stores/scheduler-store.ts` — `loadHistory(filter?: { source?: RunHistorySource })`，不再传 planId；`historyTaskId` → `historySource`；分页与 seq 竞态守卫不变
  - `app/data-center/history-panel.tsx` — 「按任务筛选」→「按类型筛选」（SOURCE_OPTIONS 由 SOURCE_META 生成，onValueChange 走后端参数）；RunningSection 条目加类型徽章；删 tasks/loadTasks 依赖；空态文案覆盖类型维度
  - `app/data-center/HistoryEntryCard.tsx` — 标题行加类型徽章；触发方式徽章仅 `resolveSource(entry.source) === 'scheduler'` 显示
- 验证：`bunx tsc --noEmit -p tsconfig.json` 通过；`bun run lint` 0 errors（83 个既有 any warning，与本次无关）；四个改动文件单独 eslint 零输出。运行时四类任务各自入史的可视验证留待用户日常使用确认。

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SOURCE_META: Record<RunHistorySource, { label, badgeCls }>`；`resolveSource(source?: RunHistorySource): RunHistorySource`
  - `loadHistory(filter?: { source?: RunHistorySource })`；store 内 `historySource` 持久于分页（loadMoreHistory 透传）
- 下个 step 该从哪里继续：本计划最后一步，无后续 step。
- 待办或已知限制：① 状态筛选仍是前端过滤（沿用既有行为），状态筛选下「加载更多」按钮可能被隐藏（visible 为空时），与改动前一致；② 类型徽章与状态徽章在 scheduler 中性色上可能与 cancelled/missed 状态徽章同色，属可接受的中性语义复用。
