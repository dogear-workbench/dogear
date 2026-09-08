---
step: 3
title: 前端展示与操作
status: pending
---

## 目标

TaskPanel 支持 interrupted 状态：分组展示、徽标、详情页操作与中断原因展示；task-store（前端）类型同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-queue-tool.md] 主进程侧 interrupted 全链路可用（reportTaskResult / interruptTask / 恢复通知）；`types/task.ts` TaskStatus/TaskGroups 已含 interrupted
- 当前关键文件状态：`stores/task-store.ts` 前端 TaskGroups 消费（listCollabTasks 六分组）；`components/notes/TaskPanel.tsx` 卡片行 + TaskDetail 详情页（rejected 现状并入 plan 组尾部，「···」菜单收操作，jumpToSourceConversation 跳来源会话已存在于 reference-guard.ts）
- 关键决策回顾：interrupted 与 rejected 同样并入 plan 组尾部显示；中断原因在 task.result；操作集 = 重新入队（→queued）/ 移回计划（→plan）/ 手动完成（→done）

## 计划改动

- [ ] `stores/task-store.ts`：TaskGroups 相关类型引用同步（若直接 import types/task.ts 则自动流转，确认无本地拷贝）
- [ ] `components/notes/TaskPanel.tsx` 分组组装（filteredGroups / 六分组常量处）：interrupted 数组并入 plan 组尾部（排在 rejected 之前或之后，与现有 rejected 追加逻辑同点）；确认 loadTasks 对八分组的兼容
- [ ] 卡片徽标：interrupted 显示「已中断」徽标（样式对齐 rejected 现有徽标，颜色区分——如橙色）；meta 行不变
- [ ] TaskDetail 详情页：interrupted 态渲染中断原因（task.result，小字样式对齐现有 result 展示）；操作按钮 = 「重新入队」（executeCollabTask，from 已放宽）+「移回计划」+「手动完成」（后两者复用现有 moveCollabTask / complete 路由，确认 from 兼容）
- [ ] 「跳来源会话」入口对 interrupted 任务可用（jumpToSourceConversation 走 execSessionId，确认现状是否已覆盖，未覆盖则补）
- [ ] 通知深链（task-focus-store 切任务 mode）对中断通知的兼容确认

## 验证

- `bun run dev` 起应用：构造一个 interrupted 任务（手工改 tasks.json status），核对：分组显示、徽标、详情操作流转（重新入队 → queued → 队列拾起）、跳来源会话
- 前端 tsc 无错（`bunx tsc -p tsconfig.json --noEmit`）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 全部 step 完成后：回 plan.md 勾掉步骤索引并补「完成总结」
