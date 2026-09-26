# 文章与笔记域（articles）

网络文章解析与预览、笔记卡片系统、协作任务面板 UI（笔记面板的 mode 之一）。任务后端运行时见 agent-core.md。

## 页面与组件

- `components/ArticlePreview.tsx` — 网络文章内容预览 + 选中文字浮动引用按钮（主窗口文章 tab 与独立会话窗口双挂载）
- `components/notes/NotesPanel.tsx` — 笔记面板编排容器：四 mode 顶栏（笔记/任务/回收站/报告）+ 搜索（300ms 防抖+seq 竞态保护）+ 标签筛选 + Ctrl+\ 列表显隐
- `components/notes/NotesTimelinePane.tsx` — 笔记 mode 内容区：时间流 aside+拖拽分隔线+NoteEditor；删除/引用收口在此
- `components/notes/NoteEditor.tsx` — 卡片详情编辑：标题剥离、元数据区（标签 chips + article:/stock:/plan: 前缀链接）、800ms 防抖保存+卸载 flush
- `components/notes/TiptapEditor.tsx` + `tiptap/` — Tiptap 3 所见即所得编辑器（markdown 真源，tiptap-markdown 往返；input rules、勾选项可点、BubbleToolbar、SlashMenu、粘贴 markdown 解析）
- `components/notes/TagFilterMenu.tsx` / `NoteCardItem.tsx` / `NoteState.tsx` — 标签下拉 / 时间流卡片行 / 空态加载态
- `components/notes/TaskPanel.tsx` — 任务 mode：六分组看板（plan/backlog/queued/running/review/done；rejected 并入 plan 组）、hover 操作+···菜单、详情 TaskDetail
- `components/notes/TrashView.tsx` — 回收站 mode：笔记/任务两段聚合、恢复/彻底删除
- `components/notes/history-utils` 等 — 执行历史格式化复用件（另见 data-center.md）

## Stores（stores/）

- `article-store.ts` — 文章状态：选中文章/解析/URL 输入；selectArticle 自动切文章哨兵 tab，三条清空路径共用 tab 回退处理
- `notes-store.ts` — 笔记前端：notes 列表/activeNoteId/CRUD（乐观更新+广播兜底）
- `task-store.ts` — 协作任务前端：六分组/loadTasks/executeTask/moveTask/广播订阅
- `task-focus-store.ts` — 任务通知深链（focusReq{taskId,seq}，NotesPanel 切 mode 与 TaskPanel 选中响应）

## 数据层（services/）

- `article-service.ts` — 网络文章服务 facade（保持 tipc 层 import 路径不变）；实现在 `services/article/` 六文件：fetch（平台脚本优先）/parse（Readability+平台预处理，微信公众号短内容从 JS 变量提取）/tree（文章分区树）/crud（分区与条目 CRUD）/order-index（排序索引）/types
- `article-parser-skills-service.ts` — 文章解析 Skills 与 MCP 工具定义（运行时目录 `.dogear/article-parser/`，首跑迁移旧目录）
- `notes/notes-store.ts` — 笔记 IO 原语（存 config `workspaces/{id}/notes`，已从项目工作区迁入）：一卡一 md、frontmatter 解析（YAML 兼容子集零依赖）、原子写、index.json 维护、.trash 移动
- `notes/notes-service.ts` — 笔记 CRUD 唯一写入口（create/get/list/update/软删/恢复/purge/搜索），写后广播 notesChanged

## Agent 工具与类型

- `agents/tools/article-tools.ts` — dogear__ReadArticle / dogear__ListArticles
- `agents/tools/notes-tools.ts` — dogear-notes server 六工具（CreateNote/GetNote/SearchNotes/AppendNote/UpdateNote/DeleteNote 软删除），直调 notes-service
- `types/article.ts` / `types/note.ts` / `types/task.ts` — 文章 / 笔记 / 协作任务数据模型（主进程镜像在各 service 内）

## 注意

- 笔记文件为真源（frontmatter 承载元数据），notes-service 是唯一写入口，写后广播 notesChanged 驱动前端重拉
- 正文待办 = TiptapEditor checkbox 勾选项落盘，无独立待办实体；frontmatter 遇 todos: 块直接忽略
- 旧卡内 todos 类型链已退役删除
- 任务面板（TaskPanel/task-store）只是 UI，任务状态机与队列在 agent-core.md；任务深链通知经 task-focus-store

## 数据流

- 文章解析后台任务：Renderer → tipc.submitTask（PARSE_ARTICLE）→ agent-worker → tasks/parse-article-task（pi runOnce + article-parse-tools 工具抓取）→ agentTaskUpdate 事件回传；文章 tab 选中由 article-store.selectedArticle 驱动挂载
