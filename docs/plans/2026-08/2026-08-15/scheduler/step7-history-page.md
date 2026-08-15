---
step: 7
title: 执行历史页面 + 收尾
status: done
---

## 目标

独立「执行历史」页面（状态徽章/触发原因/token/摘要展开/分页），最后同步 codebase-map。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step6 的 scheduler-store（含 `listRunHistory` 接入情况以其实施回填为准）、设置页 SchedulerPanel 顶部已预留「查看执行历史」跳转
- 路由模式：HashRouter，路由注册在 `src/App.tsx`；Markdown 渲染不需要；时间格式化参考 `components/conversation-list/utils.ts` 的 `getRelativeTime`
- 关键决策回顾：历史条目两种 kind——task（任务执行完整条目）与 missed（触发错过，无 taskId）；missed 灰色显示「未运行」；倒序分页

## 计划改动

- [x] 新建 `app/run-history/page.tsx`：独立页面，顶部筛选（计划下拉 + 状态筛选）+ 「返回设置」入口；列表项：状态徽章（completed=绿 / failed=红 / cancelled=灰 / missed=灰「未运行」/ interrupted=黄 / 运行中不出现——运行中走 activity，页面顶部另设「正在运行」小节显示 activity 内容）、计划名 / 任务名、触发原因徽章（时间/条件/手动 + triggerDesc tooltip）、起止时间与耗时、token 用量、结果摘要折叠展开（failed 显示 error）；底部「加载更多」（cursor 分页）
- [x] `src/App.tsx` 注册路由 `/run-history`；step6 预留的跳转接通
- [x] scheduler-store 补 `history / historyCursor / loadingMore` 状态与 `loadHistory(planId?)` / `loadMoreHistory()`（若 step6 未做）
- [x] doc-sync：更新 `docs/codebase-map.md`——services/scheduler/ 各文件、tipc scheduler 路由、stores/scheduler-store、settings/scheduler 组件、run-history 页面、触发点迁移说明（组提炼链路段落的「三触发点」描述改为调度器）、`.dogear/plans.json` 与 `run-history/` 存储条目

## 验证

- [ ] `bun run dev` 全链路：跑几个计划（含手动、错过窗口的）→ 历史页正确展示各状态；分页加载正常；筛选生效（留主会话做全链路回归，见 step7-delivery.md 建议）
- [x] 全量回归：设置页原有手动按钮不受影响（未触碰）、`bun run lint`（0 errors / 74 warnings 全存量）与 `bun run build:renderer` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：详见项目根 `step7-delivery.md`「与计划的差异说明」（7 条）。要点：页面拆三文件（page / HistoryEntryCard / utils，控体量）；store 增加 historyError + historyPlanId + historySeq 竞态守卫；listRunHistory 返回接口联合类型需 `'error' in r` 收窄；「正在运行」复用 store 轮询（不自建）；状态筛选为客户端过滤；60s tick 刷新相对时间
- 改动文件清单：新增 `app/run-history/{page.tsx, HistoryEntryCard.tsx, utils.ts}`（178/119/82 行）；修改 `stores/scheduler-store.ts`（+82 行 history 状态与分页）、`src/App.tsx`（+2 行路由）、`docs/codebase-map.md`（scheduler 相关段落，未动他人未提交改动）

### 给下一步的接力棒
- 关键签名 / 数据结构：store 新增 `history / historyPlanId / historyCursor / historyLoading / historyError / loadingMore` + `loadHistory(planId?)` / `loadMoreHistory()`；页内 `STATUS_META`（状态→中文+徽章配色）、`TRIGGER_REASON_LABELS`、`formatDateTimeShort / formatRelativePast / formatDuration / formatTokenCount / describeTokens` 全在 `app/run-history/utils.ts`
- 下个 step 该从哪里继续：本 step 为最后一步，无后续 step；主会话做完整 dev 模式全链路回归（建议清单见 `step7-delivery.md`）
- 待办或已知限制：状态筛选只作用于已加载条目（后端无 status 参数）；同 ts 条目在 cursor 分页边界可能被 before 语义跳过（后端 step5 语义，低概率）；triggerDesc 用原生 title 提示（项目内 Tooltip 组件尚无使用先例）。全部详见 step7-delivery.md「待办或已知限制」
