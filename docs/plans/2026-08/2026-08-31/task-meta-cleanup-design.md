# 任务信息位精简与笔记挂钩移除 设计

**背景**：任务卡片（300px 侧栏）信息位被「关联笔记按钮 + planPath 常显」占满，hover 操作按钮和时间被挤没了；「取消」「移回计划」易误触且少用却占按钮位。`task.noteId` 已无生产写入方（`dogear__CreateTask` 不传、迁移不用），是纯死字段——现行流程 Agent 直接创建任务，不经笔记。

**目标**：
1. 任务卡片信息位只留时间（左）+ hover 操作按钮（右），与笔记卡片布局一致
2. 易误触少用操作（取消、移回计划）收进「更多」菜单
3. 删除任务与笔记的 UI 挂钩及 `noteId` 死字段

**架构**：

任务卡片按钮分配：

| 状态 | 常显 hover 按钮 | 「更多」菜单 |
|---|---|---|
| plan / rejected | 移到待办 | 删除 |
| backlog | 执行 | 手动完成、删除 |
| queued / running | — | 取消 |
| done | — | 移回计划、删除 |
| review | — | 手动完成、删除（保持现状） |

排除的选项：
- 详情页操作按钮区保留全量（移回计划/取消等）——详情页是明确操作面，无误触问题
- 搜索按 planPath 匹配的功能保留——显示归显示，搜索归搜索
- 存量任务 JSON 里残留的 noteId 键不清理——解析时被忽略，无害

**模块边界**：
- `components/notes/TaskPanel.tsx`：TaskCardItem 信息位重排；删 noteId 按钮 / noteTitle 查询 / planPath 常显 / onOpenNote prop；按钮按上表分配
- `components/notes/NotesPanel.tsx`：删 openNoteFromPanels 与 TaskPanel 传参
- `components/notes/TaskDetail.tsx`：信息位删 planPath；挪到「计划文档」小节标题旁小字（truncate + title 全路径）
- `types/task.ts` / `electron/main/services/task-store.ts`：删 noteId 字段（Task、CreateTaskInput、createTask 写入）
- `electron/main/services/task-store.test.ts`：去掉 noteId 断言

**数据流**：无变化（纯展示层删减 + 死字段移除）。

**错误处理 / 边界情况**：存量任务 JSON 的 noteId 键被类型解析忽略，无需数据迁移。

**未决问题**：无。
