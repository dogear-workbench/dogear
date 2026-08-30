# 三实体分离设计：笔记 / 待办（人）/ 任务（agent）

**日期**：2026-08-30
**状态**：已拍板

## 背景

「待办」概念当前寄生在笔记 frontmatter 的 todos 字段（agent 存卡时挂的可实施项，带 plan），占用了「待办」这个名字，但用户真正需要的「以人为主的待办事项」没有实体。概念模型应为三套独立数据：

| 实体 | 主体 | 定位 |
|------|------|------|
| 笔记 | 内容 | 卡片，纯内容载体（content/tags/links/source） |
| 待办 | 人 | 用户本人的待办事项，手动建 + 聊天中 agent 帮记 |
| 任务 | agent | 实施任务，分两层：**积压**（backlog，还没决定执行）与**执行**（queued 起的队列） |

现有「可执行待办」（笔记 todos 带 plan）本质是 agent 任务的积压层，应归入任务体系。三数据分开，后续可联动。

## 目标

1. 笔记瘦身：frontmatter 去掉 todos 字段，写入侧移除、读取侧容忍忽略
2. 可执行待办迁入任务体系：Task 状态机加 `backlog` 状态
3. 新建人的待办实体：`.dogear/todos.json`，支持 due（可选，无通知）、双链笔记
4. UI 重排：顶栏四 mode（笔记 | 待办 | 任务 | 回收站）+ 分域搜索
5. 笔记列表卡片会话列表化（标题独占、按钮 hover 浮出 meta 行）、标签过滤合流进搜索行

## 架构

### 数据层

**人的待办** `.dogear/todos.json`：

```ts
interface HumanTodo {
  id: string;
  text: string;
  status: 'pending' | 'done';
  due?: string;          // ISO 日期，可选；排序用，不做系统通知
  noteId?: string;       // 双链笔记
  source: 'manual' | 'agent';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;    // 软删除 → 回收站
}
```

**任务积压层**：不建新实体，Task 状态机扩展，新增字段 `noteId?`（来源卡片）与 `deletedAt?`：

```
backlog → queued → running → review → done | rejected
```

**回收站**：笔记沿用现有 trash 目录（文件移动）机制；待办/任务用 `deletedAt` 软删除；回收站 mode 聚合三源。

**迁移**（一次性，幂等，应用启动检测执行）：
- 存量笔记 frontmatter todos 带 plan：pending（1 条，v7xr7530）→ backlog 任务（挂 noteId）；done（3 条）→ done 任务保留历史
- 迁移后清掉 frontmatter 的 todos 字段

### 排除的选项

- **B 只改门面**（数据仍寄生笔记、只挪 UI）：概念边界继续糊，否
- **完整提醒**（due + 系统通知）：通知链路成本高且打扰，选 B 方案（due 仅排序标红），后续需要再加通知、字段不动
- **backlog 独立实体**：与 Task 两套结构重复，选状态机扩展

### agent 工具链

**dogear-notes 瘦身**：
- `CreateNote` 去掉 `todos` 参数
- `ListTodos` 工具移除（概念由任务 backlog 承接）
- `UpdateNote` 的 todos patch 移除

**新 dogear-todos 组**（人的待办）：
- `createTodo(text, due?, noteId?)` —— 聊天中用户说「记一下」，agent 落待办
- `completeTodo(id)` / `listHumanTodos()`

**dogear-tasks 调整**：
- `CreateTask` 加 `autoExecute` 参数，**默认 false 落 backlog**（积压是常态，执行是决定；用户明确说「去做」才传 true）
- 新增 `executeTask(taskId)`：backlog → queued（agent 侧；UI 对应任务 tab「执行」按钮）

**提示词/纪律联动**：
- 主会话「笔记存卡纪律」重写为四步动线：聊完方案 → 落 plan 文档 → 存卡（无 todos）→ `CreateTask(autoExecute=false)` 落积压
- staged-execution skill 中「ListTodos(hasPlan=true) 找可实施项」改为「ListTasks 看 backlog 分组」

## UI

**顶栏**：`[笔记 | 待办 | 任务 | 回收站]` 四 mode + 分域搜索框常驻 + 右侧上下文按钮（笔记 mode 显「新建卡片」，待办 mode 隐（清单自带输入行），任务/回收站无）。

**笔记 mode**：
- 左侧二级切换整排撤掉（标签 tab 砍、待办 tab 撤、回收站 mode 挪走），时间流独占
- 卡片项会话列表化（参照 `components/conversation-list/ConversationRow.tsx:100`）：标题独占全宽 truncate；meta 行 = 相对时间 + hover 浮出引用/删除按钮（`ml-auto`，`opacity-0 pointer-events-none → group-hover:opacity-100`）
- 搜索行：搜索框 + `#` 标签下拉（带每标签计数、选中变 chip、与搜索词可叠加过滤，复用 `searchNotes` 的 query+tag）

**待办 mode**（新建 TodosPanel）：
- 单列轻清单，顶部常驻快速输入行（Enter 即建）
- 排序：未完成在前（due 升序、过期标红、无 due 靠后），完成折叠区收底
- 行：checkbox + 文本 + due + 关联笔记 chip（点击跳笔记 mode 打开该卡）+ hover 编辑/删除（软删）；`source: agent` 带小图标区分

**任务 mode**（TaskPanel 扩展）：
- 「积压」分组置顶，行内：标题 + 来源笔记链接 + 「执行」按钮 → queued
- 现有五状态分组、review 徽章、通知深链不动

**回收站 mode**（TrashView 扩展）：
- 三段：笔记 / 待办 / 任务，各段标题带计数
- 笔记段沿用现有恢复/彻底删除；待办/任务段恢复（清 deletedAt）/彻底删除

**分域搜索**：笔记走 `searchNotes`（query+tag）；待办/任务/回收站数据量小，前端 store 过滤（待办搜 text、任务搜 title/planPath、回收站搜三源）。

## 模块边界

**新增**：
- `electron/main/services/todo-service.ts` — 人待办 CRUD + 软删除（存储同 tasks.json 原子写模式）
- `electron/main/tipc/todos.ts` — 人待办路由
- `electron/main/agents/tools/todo-tools.ts` — dogear-todos 工具组（`registerTools()` 注册元数据）
- `components/notes/TodosPanel.tsx` — 待办 mode 视图
- `types/todo.ts`
- 迁移逻辑（notes todos → task backlog，幂等）

**修改**：
- `components/notes/NotesPanel.tsx` — 四 mode 顶栏 + 分域搜索 + 二级 tab 撤
- `components/notes/NoteCardItem.tsx` — meta 行会话列表化
- `components/notes/TaskPanel.tsx` — 积压分组 + 执行按钮
- `components/notes/TrashView.tsx` — 三段聚合
- `electron/main/tipc/notes.ts` — ListTodos 路由移除、CreateNote schema 瘦身
- `electron/main/services/task-store.ts` / `task-service.ts` — backlog 状态、deletedAt、noteId、executeTask、软删恢复
- `electron/main/tipc/tasks.ts` — executeTask / 删除 / 恢复路由
- `electron/main/agents/tools/`（notes 工具瘦身、task-tools 加参数）
- `stores/` — 新 `todo-store.ts`；notes-store/task-store 调整
- `types/note.ts` / `types/task.ts`
- 提示词：主会话 agent.md 笔记存卡纪律段、staged-execution skill 模板

**删除**：
- `components/notes/TodosView.tsx`（被任务 backlog + TodosPanel 取代）
- `components/notes/TagsView.tsx`（被搜索行 # 下拉取代）

## 数据流

- **存卡动线**：聊完方案 → plan 落盘 → 存卡（无 todos）→ `CreateTask(autoExecute=false)` 落 backlog（挂 noteId）
- **执行动线**：任务 tab backlog 行「执行」（或 agent `executeTask`）→ queued → 串行队列自动创建执行会话 → review → done/rejected
- **待办动线**：手动快速输入 / agent `createTodo` → todos.json → 待办 mode 勾选完成；删除 → 软删进回收站
- **回收站**：三源聚合展示，恢复/彻底删除分流到各自 service

## 错误处理 / 边界

- `noteId` 悬空（目标笔记已删/在回收站）：链接灰态不可点，不自动清理，笔记恢复后自愈
- 迁移幂等：frontmatter 有 todos 才迁，跑过即跳过
- todos.json / tasks.json：主进程单点写 + 原子写
- due：UI 用日期选择器，不做自然语言解析；agent `createTodo` 传 ISO 日期（自然语言理解归 agent）

## 实施注意事项

1. **已解除的并行约束**：笔记详情撑大页面 bug 已由另一会话修复（根因：MDXEditor 向 body append popup 容器时复制 className，`mt-2` 泄漏产生 ~10px 滚动区；修法：`components/notes/NoteEditor.tsx:308` 间距外包 div）。该修复只动 NoteEditor，与本设计模块清单无交集，可直接动工
2. 主进程改动需 `build:electron` 重新编译
3. agent 工具元数据走 `registerTools()`，前端 `client.getRegisteredTools()` 动态获取，不硬编码
4. 完成后按 doc-sync 同步 `docs/codebase-map.md`

## 未决问题（实施时定）

- done 待办归档策略：全量堆积 / 折叠区 / 定期清理
- agent 记待办是否需要确认（暂定直接记：明确指令场景）
- 搜索行 # 下拉多标签选择（暂定单选够用）

## 未来联动方向（本期不做，设计留口）

- 人的待办一键转任务（「这事让 agent 做」→ backlog 或直接执行）
- 任务结果回写关联（待办/笔记反链展示）
- 笔记选中文本转待办
