---
step: 1
title: 数据层与迁移
status: pending
---

## 目标

主进程数据层就位：Task 支持 backlog/软删/笔记关联，人待办 service 建好，存量笔记 todos 迁移进任务体系，笔记写入侧不再产出 todos 字段。

## 依赖上下文（接力棒输入）

- 设计依据：`docs/plans/2026-08/2026-08-30/three-entities-design.md` §架构
- 现状：`electron/main/services/task-store.ts` 已有五状态状态机与原子写；`task-service.ts` 有 listTasksGrouped/getTaskDetail/reviewTask；`notes-service.ts` frontmatter 写含 todos
- 关键决策：backlog 不建独立实体（Task 状态机扩展）；迁移幂等（frontmatter 有 todos 才迁）

## 计划改动

- [ ] `types/task.ts`：Task 类型加 `'backlog'` 状态、`noteId?: string`、`deletedAt?: string`
- [ ] `electron/main/services/task-store.ts`：创建任务支持初始 `backlog` 状态；列表/分组输出含 backlog 分组且默认过滤 `deletedAt` 非空项；加软删（置 deletedAt）/恢复（清 deletedAt）/彻底删除（移出数组）
- [ ] `electron/main/services/task-service.ts`：加 `executeTask`（backlog → queued，复用现有入队逻辑）；加 `deleteTask` / `restoreTask` / `purgeTask`
- [ ] 新建 `electron/main/services/todo-service.ts`：`.dogear/todos.json` 的 create/list（过滤 deletedAt）/updateText/updateDue/setStatus（pending↔done）/软删/恢复/彻底删除；原子写照抄 task-store 模式
- [ ] 新建 `types/todo.ts`：HumanTodo 结构（见 plan.md 全局决策）
- [ ] 迁移逻辑（放 notes-service 或独立 `migrate-notes-todos.ts`）：启动时检测——遍历笔记文件 frontmatter todos：带 plan 的 `pending` → 创建 backlog Task（挂 noteId、subject 取 todo.text）；带 plan 的 `done` → done Task 保留历史；无 plan → 转人待办（manual source）；迁移完从 frontmatter 删除 todos 字段并回写文件
- [ ] `electron/main/services/notes-service.ts`：笔记写入侧（保存/更新）不再输出 todos 字段；读取侧遇到旧文件含 todos 忽略即可
- [ ] 迁移与软删恢复广播：复用/新增 tasksChanged 广播（todo 侧本 step 可先不动广播，step3 前补）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
