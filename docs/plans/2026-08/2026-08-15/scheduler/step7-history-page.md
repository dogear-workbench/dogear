---
step: 7
title: 执行历史页面 + 收尾
status: pending
---

## 目标

独立「执行历史」页面（状态徽章/触发原因/token/摘要展开/分页），最后同步 codebase-map。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step6 的 scheduler-store（含 `listRunHistory` 接入情况以其实施回填为准）、设置页 SchedulerPanel 顶部已预留「查看执行历史」跳转
- 路由模式：HashRouter，路由注册在 `src/App.tsx`；Markdown 渲染不需要；时间格式化参考 `components/conversation-list/utils.ts` 的 `getRelativeTime`
- 关键决策回顾：历史条目两种 kind——task（任务执行完整条目）与 missed（触发错过，无 taskId）；missed 灰色显示「未运行」；倒序分页

## 计划改动

- [ ] 新建 `app/run-history/page.tsx`：独立页面，顶部筛选（计划下拉 + 状态筛选）+ 「返回设置」入口；列表项：状态徽章（completed=绿 / failed=红 / cancelled=灰 / missed=灰「未运行」/ interrupted=黄 / 运行中不出现——运行中走 activity，页面顶部另设「正在运行」小节显示 activity 内容）、计划名 / 任务名、触发原因徽章（时间/条件/手动 + triggerDesc tooltip）、起止时间与耗时、token 用量、结果摘要折叠展开（failed 显示 error）；底部「加载更多」（cursor 分页）
- [ ] `src/App.tsx` 注册路由 `/run-history`；step6 预留的跳转接通
- [ ] scheduler-store 补 `history / historyCursor / loadingMore` 状态与 `loadHistory(planId?)` / `loadMoreHistory()`（若 step6 未做）
- [ ] doc-sync：更新 `docs/codebase-map.md`——services/scheduler/ 各文件、tipc scheduler 路由、stores/scheduler-store、settings/scheduler 组件、run-history 页面、触发点迁移说明（组提炼链路段落的「三触发点」描述改为调度器）、`.dogear/plans.json` 与 `run-history/` 存储条目

## 验证

- `bun run dev` 全链路：跑几个计划（含手动、错过窗口的）→ 历史页正确展示各状态；分页加载正常；筛选生效
- 全量回归：夜间维护出厂计划行为、设置页原有手动按钮不受影响、`bun run lint` 与 `bun run build` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
