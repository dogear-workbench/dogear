---
step: 5
title: 任务视图
status: pending
---

## 目标
TaskPanel 上线：任务列表按状态分组、详情聚合（plan 渲染/执行会话链接/结果/审核），顶栏 `[任务]` tab 接通，通知点击深链待审任务。

## 依赖上下文（接力棒输入）
- 设计依据：`../notes-page-redesign-design.md` 架构第 4 节
- 前置 step 产出：[step2] 笔记页骨架顶栏有 `[任务]` 占位 tab、列表|详情 300px 骨架；[step4] tipc 路由 `tasks.list/get/review` 与 Task 数据结构（签名见回填）
- 现状事实：任务视图复用 NotesPanel 的列表|详情空间（互斥显示，同 app/page.tsx 挂载模式）

## 计划改动
- [ ] 新 `components/notes/TaskPanel.tsx`：
  - 列表：按 `queued/running/review/done(+rejected)` 分组渲染任务卡片（标题+状态徽章+时间）
  - 详情：任务标题+状态徽章；plan 文件内容渲染（markdown 渲染组件查现有复用）；执行会话链接（有 execSessionId 时显示，点击跳会话 tab——复用 Step 3 来源跳转的机制）；result 摘要；`review` 态显示 `[✓ 通过] [↩ 打回]`（tipc `tasks.review`），其余态只读
  - rejected 态显示打回态样式；重挂不做（用户改后由 agent 重新 CreateTask）
- [ ] `NotesPanel.tsx`：顶栏 `[任务]` tab 接通 TaskPanel（互斥显示，与笔记视图切换）
- [ ] 通知点击深链：主进程通知 → 聚焦应用 → 激活笔记页任务视图 → 选中该待审任务（渲染进程路由，查现有 tab 激活链路）
- [ ] 待审徽章：顶栏 `[任务]` tab 上显示 review 态计数（0 时隐藏）

## 验收
- 顶栏切换笔记/任务视图正常，骨架一致
- 从挂载到执行到待审到通过/打回，全程在任务视图可见状态流转
- 详情内点执行会话链接能跳到该会话
- 通知点击落到待审任务详情
- review 计数徽章随状态增减

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
