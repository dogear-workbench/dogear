---
step: 4
title: 回收站三段
status: pending
---

## 目标

回收站从笔记单源扩展为笔记/待办/任务三段聚合，恢复与彻底删除分流到各自 service。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 软删字段（deletedAt）与恢复/彻底删除 service；step2 tipc 路由（restoreTodo/purgeTodo、restoreTask/purgeTask 已有或本步补）
- 现状：`components/notes/TrashView.tsx` 笔记单列（listTrashNotes/restoreNote/purgeNote 文件级移动机制）

## 计划改动

- [ ] `components/notes/TrashView.tsx` 扩展：
  - 三段布局：笔记 / 待办 / 任务，段标题带计数，空段不显示
  - 笔记段沿用现有恢复/彻底删除
  - 待办段：文本 + 删除时间，恢复（清 deletedAt）/彻底删除
  - 任务段：标题 + 删除时间，恢复/彻底删除
  - 接收 `query` prop 过滤三源（笔记标题、待办 text、任务 title）
- [ ] 缺的 tipc 路由本步补齐（对照 step2 产出）
- [ ] stores：todo-store/task-store 加回收站列表与恢复/彻底删除动作（若 step3 未覆盖）

## 验收

- 三类实体软删后都出现在回收站对应段；恢复回原视图；彻底删除消失且不进回收站
- 搜索过滤三段

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
