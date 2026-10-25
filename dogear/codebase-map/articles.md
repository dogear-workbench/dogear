# 文章与笔记域（articles）

网络文章解析与预览、笔记卡片系统。协作任务面板 UI 在 `app/tasks-panel/`（另见 data-center.md），任务后端运行时见 agent-core.md。

## 页面与组件

- `components/companion/ArticleReadingView.tsx` / `ReadingPanel.tsx` / `ReadingContent.tsx` / `QuotableContent.tsx` / `article-parse-status.tsx` — 伴随面板阅读 tab 文章视图族（按需加载详情+选字引用+解析状态；原 ArticlePreview 已删，职责迁此）
- `components/notes/NotesPanel.tsx` — 笔记面板编排容器：纯笔记单视图；挂载 NotesSearchProvider（顶栏笔记搜索：notes-store 标题+标签同步过滤，命中 setActiveNoteId 定位打开卡片）
- `components/notes/NotesTimelinePane.tsx` — 笔记内容区：时间流 aside+拖拽分隔线+NoteEditor；删除/引用收口在此
- `components/notes/NotesListToolbar.tsx` — 笔记列表工具条（搜索/标签筛选/排序；原 TagFilterMenu 并入）
- `components/notes/NoteEditor.tsx` — 卡片详情编辑：标题剥离、元数据区（NoteMetaSection：标签 chips + article:/stock:/plan: 前缀链接）、800ms 防抖保存+卸载 flush
- `components/notes/TiptapEditor.tsx` + `tiptap/` — Tiptap 3 所见即所得编辑器（markdown 真源，tiptap-markdown 往返；input rules、勾选项可点、BubbleToolbar、SlashMenu、粘贴 markdown 解析）
- `components/notes/NoteCardItem.tsx` / `NoteState.tsx` / `month-grouping.ts` — 时间流卡片行 / 空态加载态 / 月份分段纯函数
- `app/tasks-panel/` — 统一任务面板（定时任务/协作任务/解析记录三区 + 右栏详情/只读历史），TaskDetail/TaskCardItem/TaskStatusBadge 协作任务渲染件在此；执行会话/定时运行行经 ChildSessionFold 默认收起挂子会话列表（计数+chevron 开关，展开后状态徽标 + 点击右栏切子会话视图，panelActive 视同 tab 激活修冷会话「连接中」）；详见 data-center.md
- `components/archive/TrashView.tsx` — 归档页回收站段（左列「话题|回收站」分段）：笔记/任务两段聚合、恢复/彻底删除/清空回收站

## Stores（stores/）

- `article-store.ts` — 文章状态：选中文章（路径形态）/URL 输入；selectArticle 打开阅读 tab（阅读视图按 dogear/articles 内路径识别文章模式）；retryParse 重试解析
- `notes-store.ts` — 笔记前端：notes 列表/activeNoteId/CRUD（乐观更新+广播兜底）
- `task-store.ts` — 协作任务前端：八分组/loadTasks/executeTask/moveTask/广播订阅（任务面板与顶栏状态徽章共用）
- `task-focus-store.ts` — 任务深链（focusReq{taskId,seq}，任务面板 CollabTaskSection 响应选中）

## 数据层（services/）

- `article-service.ts` — 网络文章服务 facade（保持 tipc 层 import 路径不变）；实现在 `services/article/` 七文件：fetch（平台脚本优先；资源防线：扩展名黑名单 + 响应体含 `<html`/`<!doctype` 才放行）/parse（Readability+平台预处理，微信公众号短内容从 JS 变量提取）/frontmatter（md 元数据 YAML 子集读写）/pipeline（URL→抓取→解析→落盘编排）/parse-ai-fallback（后台 AI 兑底与执行历史落盘）/crud（文章库读写；findArticleFileById 按 frontmatter id 全扫定位，历史 articleId 引用打开兑底）/types；文章库 = 工作区文件 `{workspacePath}/dogear/articles/`（一文一 md + frontmatter 承载 id/url/title 等元数据 + `<slug>.raw.html` 原文伴随），识别规则 types.ts `ARTICLES_DIR`/`isArticlesRelPath`；frontmatter 缺失按普通 md 降级；文件树单区不设专区（workspaceFsService 扫描时 md 读 frontmatter 识别为文章节点）；文章=工作区文件不进应用同步/备份（跨设备走用户 git 或同步页勾选 dogear/articles 子树），configDir 旧库位置 workspaces/{wsid}/articles 已进同步退役防线（manifest.ts isRetiredConfigArticles 恒排除 + 墓碑豁免驱动旧对端清理）
- `article/pipeline.ts` — 文章解析管线编排（URL→抓取→平台脚本→Readability→入库；tipc 手动导入与 dogear__SaveArticle 共用）
- `article/parse-ai-fallback.ts` — 后台 AI 兜底与执行历史落盘（PARSE_ARTICLE 提交 + article-parser/history.jsonl 追加）
- `article-parser-skills-service.ts` — 文章解析 Skills 与 MCP 工具定义（运行时目录 `.dogear/article-parser/`，首跑迁移旧目录）
- `notes/notes-store.ts` — 笔记 IO 原语（存 config `workspaces/{id}/notes`，已从项目工作区迁入）：一卡一 md、frontmatter 解析（YAML 兼容子集零依赖）、原子写、index.json 维护、.trash 移动
- `notes/notes-service.ts` — 笔记 CRUD 唯一写入口（create/get/list/update/软删/恢复/purge/搜索），写后广播 notesChanged

## Agent 工具与类型

- `agents/tools/article-tools.ts` — dogear-article server 单工具：SaveArticle（URL 入库落盘 md 返回路径，与文件树导入同一管线；folderPath 支持多层；URL 去重扫 frontmatter；读检索走通用 Read/Grep/Glob，SearchArticles/ReadArticle/ListArticles 已随路径化退役）
- `agents/tools/notes-tools.ts` — dogear-notes server 六工具（CreateNote/GetNote/SearchNotes/AppendNote/UpdateNote/DeleteNote 软删除），直调 notes-service
- `types/article.ts` / `types/note.ts` / `types/task.ts` — 文章 / 笔记 / 协作任务数据模型（主进程镜像在各 service 内）

## 注意

- 文章以 md 为真源（frontmatter 承载 id/url/title 等元数据），id 是稳定标识（文件/文件夹可自由改名，历史 articleId 引用靠 crud.findArticleFileById 全扫兑底解析）；URL 去重扫 frontmatter url
- 笔记文件为真源（frontmatter 承载元数据），notes-service 是唯一写入口，写后广播 notesChanged 驱动前端重拉
- 正文待办 = TiptapEditor checkbox 勾选项落盘，无独立待办实体；frontmatter 遇 todos: 块直接忽略
- 旧卡内 todos 类型链已退役删除
- 任务面板（app/tasks-panel/）只是 UI，任务状态机与队列在 agent-core.md；任务深链通知经 task-focus-store

## 数据流

- 文章解析后台任务：Renderer（tipc 手动导入 / dogear__SaveArticle）→ article/pipeline（静态失败落 stub 后提交）→ agentManager.submitTask（PARSE_ARTICLE，内部调用非 tipc 路由）→ agent-worker → tasks/parse-article-task（pi runOnce + article-parse-tools 工具抓取）→ agentTaskUpdate 事件回传，parse-ai-fallback 追加解析历史 article-parser/history.jsonl；文章 tab 选中由 article-store.selectedArticle 驱动挂载
