---
step: 5
title: 任务积压分组
status: pending
---

## 目标

TaskPanel 加「积压」分组置顶，backlog 项可看来源笔记与 plan，一键「执行」进队列。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1/2 的 backlog 状态与 executeTask 路由；step3 的笔记跳转方式（若有复用）
- 现状：`components/notes/TaskPanel.tsx` 五状态分组列表 + TaskDetail；`stores/task-store.ts` 的 groups 结构

## 计划改动

- [ ] `stores/task-store.ts`：groups 加 backlog 分组；加 `executeTask(taskId)` 动作（调 tipc，成功后刷新；tasksChanged 广播已订阅则自动）
- [ ] `components/notes/TaskPanel.tsx`：「积压」分组置顶渲染——行内标题 + 来源笔记链接（noteId 有值时显示，点击切笔记 mode 打开该卡，悬空灰态）+ plan 路径 + 「执行」按钮（→ executeTask）
- [ ] TaskDetail 若 backlog 任务点开详情，「执行」按钮同样可用（或列表行内就够，详情只读——实施时按现有交互模式取自然的一种，不留死按钮）

## 验收

- 迁移产生的 backlog 项（存量 1 条）可见、可见来源笔记与 plan
- 点「执行」→ 状态变 queued → 串行队列自动创建执行会话 → review 流程不受影响
- 现有五状态分组、review 徽章、通知深链不回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
