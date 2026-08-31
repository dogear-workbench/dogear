---
step: 3
title: 任务 UI 三栏与详情渲染
status: pending
---

## 目标
TaskPanel 按「计划 → 待办 → 排队/执行/待审核 → 已完成」重排分组与按钮；TaskDetail 删除按钮收进回退旁、plan 文档路径渲染修 baseDir 基准；MarkdownRenderer 支持 baseDir。

## 依赖上下文（接力棒输入）
- 前置产出：[step2-task-data.md] 数据层已有 `plan` 态、`moveCollabTask({ workspacePath, taskId, to })` IPC、TaskGroups 七键、planPath 可空。
- 当前关键文件状态：
  - `components/notes/TaskPanel.tsx` — `TASK_GROUPS` 六组常量（backlog/queued/running/review/done/rejected）；`TaskCardItem` 标题行右侧挤「执行/取消/···」按钮 + TaskStatusBadge（挡字）；backlog 分支 meta 行有 noteId chip + planPath
  - `components/notes/TaskDetail.tsx` — 操作行三个状态分支各带删除大按钮；meta 行有返回箭头；`MarkdownRenderer content={detail.planContent} workspacePath={workspacePath}`
  - `components/MarkdownRenderer.tsx` — `openPathPreview` 以 workspacePath 解析 `a` 链接 href（`resolvePathInWorkspace`）；正文裸路径 `splitPathSegments(text, workspacePath)`
  - `components/agent-chat/path-link.tsx` — `resolvePathInWorkspace(candidate, base)` 纯函数已支持任意基准，直接复用
  - `stores/task-store.ts` — groups/loading/executeTask/cancelTask/completeTask/deleteTask，需补 moveTask
- 关键决策回顾：rejected 并入「计划」分组展示（徽标区分，不真迁移状态）；执行按钮只在待办栏；计划栏行内「移到待办」；已完成行内「移回计划」；新任务不再有 noteId chip（存量保留）；路径白名单不扩展。

## 计划改动
- [ ] `stores/task-store.ts`：加 `moveTask(workspacePath, taskId, to: 'backlog' | 'plan')` action（调 moveCollabTask，成功 loadTasks 刷新，失败 toast 返 false，模式照抄 executeTask）
- [ ] `components/notes/TaskPanel.tsx`：
  - `TASK_GROUPS` 重排：`plan`（label「计划」）/ `backlog`（label「待办」）/ `queued` / `running` / `review` / `done`（label「已完成」）；rejected 不单列——`filteredGroups` 组装时把 rejected 任务并入 plan 数组（排尾部），分组头计数随之
  - `TaskCardItem` 布局改造：标题行只留标题（全宽 truncate）+ TaskStatusBadge（rejected 在计划组内显「已打回」徽标）；操作按钮（执行/取消/移到待办/···菜单）全部下沉到 meta 行右侧，hover 浮出样式沿用 `hoverBtn`（opacity-0 → group-hover）
  - 行内按钮逻辑：`plan`（含 rejected）→ 「移到待办」（moveTask）；`backlog` → 「执行」（executeTask）+ ··· 菜单（手动完成/删除）；`queued`/`running` → 「取消」；`done` → 「移回计划」（moveTask to plan）；review → ··· 菜单照旧（删除）
  - meta 行：占位任务（无 planPath）显「无文档」灰字标识；noteId chip 仅存量任务保留
  - 前端过滤 `match` 对 `task.planPath` 判空跳过（`t.planPath?.toLowerCase().includes(q)`）
- [ ] `components/notes/TaskDetail.tsx`：
  - 删除按钮移到 meta 行返回箭头旁（icon-xs Trash2 destructive 色，同 NoteEditor.tsx:248-256 形态）；三个状态分支操作行里的删除大按钮全部移除
  - 状态分支按钮调整：plan（含 rejected）→ 「移到待话」按钮（moveTask）+ 「手动完成」；backlog → 「执行」+「手动完成」；done → 「移回计划」；其余照旧
  - planPath 显示：meta 行无 planPath 时显「尚无计划文档」；有则照旧
  - `MarkdownRenderer` 传 `baseDir`：`detail.planPath ? dirname(detail.planPath) : undefined`（posix dirname 手写三行或 path.posix——渲染层无 node path，手写 `p.replace(/[\\/][^\\/]*$/, '')` 即可）
  - 详情页对 plan 态加「挂文档」引导文案（读 planError / planContent 为 null 的展示已有，补一句提示语即可）
- [ ] `components/MarkdownRenderer.tsx`：加 `baseDir?: string` prop；`openPathPreview` 内 `resolvePathInWorkspace(href, baseDir ?? workspacePath)`；`splitPathSegments`（正文裸路径）保持 workspacePath 基准不变；useMemo 依赖补 baseDir
- [ ] `components/notes/TaskStatusBadge.tsx`：加 `plan` 态徽章（「计划」）；确认 rejected 徽标文案「已打回」
- [ ] `components/notes/TrashView.tsx`：任务段如按状态展示徽标则 plan 自动生效（走 TaskStatusBadge），确认无六态硬编码残留
- [ ] `stores/notes-store.ts` / `NotesPanel.tsx`：任务 mode 顶栏 review 徽章逻辑不受影响，确认即可

## 验证
- `bun run dev` 走查：计划组（含打回）、待办、执行中、已完成分组顺序正确；「移到待办」/「移回计划」流转通；占位任务显示「无文档」
- 列表行标题不被按钮遮挡（按钮在 meta 行 hover 浮出）
- 详情页：删除按钮在回退旁；plan 文档内 `[../xxx.md](../xxx.md)` 相对链接解析到文档所在目录基准，点击浮窗能打开正确文件
- 白名单外路径（代码文件）不渲染胶囊（维持现状）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
