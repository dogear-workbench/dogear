---
step: 3
title: 前端展示与操作
status: done
---

## 目标

TaskPanel 支持 interrupted 状态：分组展示、徽标、详情页操作与中断原因展示；task-store（前端）类型同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-queue-tool.md] 主进程侧 interrupted 全链路可用（reportTaskResult / interruptTask / 恢复通知）；`types/task.ts` TaskStatus/TaskGroups 已含 interrupted
- 当前关键文件状态：`stores/task-store.ts` 前端 TaskGroups 消费（listCollabTasks 六分组）；`components/notes/TaskPanel.tsx` 卡片行 + TaskDetail 详情页（rejected 现状并入 plan 组尾部，「···」菜单收操作，jumpToSourceConversation 跳来源会话已存在于 reference-guard.ts）
- 关键决策回顾：interrupted 与 rejected 同样并入 plan 组尾部显示；中断原因在 task.result；操作集 = 重新入队（→queued）/ 移回计划（→plan）/ 手动完成（→done）

## 计划改动

- [x] `stores/task-store.ts`：TaskGroups 相关类型引用同步（若直接 import types/task.ts 则自动流转，确认无本地拷贝）
- [x] `components/notes/TaskPanel.tsx` 分组组装（filteredGroups / 六分组常量处）：interrupted 数组并入 plan 组尾部（排在 rejected 之前或之后，与现有 rejected 追加逻辑同点）；确认 loadTasks 对八分组的兼容
- [x] 卡片徽标：interrupted 显示「已中断」徽标（样式对齐 rejected 现有徽标，颜色区分——如橙色）；meta 行不变
- [x] TaskDetail 详情页：interrupted 态渲染中断原因（task.result，小字样式对齐现有 result 展示）；操作按钮 = 「重新入队」（executeCollabTask，from 已放宽）+「移回计划」+「手动完成」（后两者复用现有 moveCollabTask / complete 路由，确认 from 兼容）
- [x] 「跳来源会话」入口对 interrupted 任务可用（jumpToSourceConversation 走 execSessionId，确认现状是否已覆盖，未覆盖则补）
- [x] 通知深链（task-focus-store 切任务 mode）对中断通知的兼容确认

## 验证

- `bun run dev` 起应用：构造一个 interrupted 任务（手工改 tasks.json status），核对：分组显示、徽标、详情操作流转（重新入队 → queued → 队列拾起）、跳来源会话
- 前端 tsc 无错（`bunx tsc -p tsconfig.json --noEmit`）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 确认类三项（task-store 类型 / 跳来源会话 / 通知深链）均零改动通过：TaskGroups 直接 import types/task.ts；「查看执行会话」按钮条件是 execSessionId 与状态无关；深链全链路只传 taskId。详见共享区 step3-delivery.md
  2. 卡片对 interrupted 不加快捷按钮：迁移表 interrupted 不含 backlog，「移到待办」会报错，且计划未要求；「···」菜单仅剩删除（任意状态可用）
  3. 「重新入队」复用 handleExecute，错误 toast 标题沿用「执行失败」（与 backlog「执行」一致）
  4. 空态计数天然正确：total 含 plan 组（已并入 interrupted），仅剩中断任务不会误显「暂无任务」
- 改动文件清单：
  - `components/notes/TaskStatusBadge.tsx`（补 interrupted key，橙色「已中断」徽标；顺带修复 step1 遗留 tsc 报错点）
  - `components/notes/TaskPanel.tsx`（filteredGroups：interrupted 并入 plan 组尾部，排在 rejected 之后）
  - `components/notes/TaskDetail.tsx`（interrupted 操作块「重新入队/移回计划/手动完成」；result 标签三分支加「中断原因」）
- 验证：`bunx tsc --noEmit` 0 错误；`bun run lint` 0 errors；真机验收清单见共享区 step3-delivery.md（bun run dev 无人值守未跑）

### 给下一步的接力棒
- 关键签名 / 数据结构：前端零新增 API——interrupted 全部复用现有路由（executeTask / moveTask('plan') / completeTask，from 主进程已放宽）；result 标签三分支 rejected/interrupted/其他
- 全部 step 完成后：回 plan.md 勾掉步骤索引并补「完成总结」；遗留待办（step2 已记录）：中断通知逐任务未合并、docs/codebase-map.md 待统一更新
