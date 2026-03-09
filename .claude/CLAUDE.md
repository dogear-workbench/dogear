# Dogear 项目指南

> AI 驱动的电子书阅读器，支持 EPUB / PDF / TXT

## 基本规则

- 使用**中文**回答
- 必要的地方添加注释

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Electron | 主进程 + 渲染进程架构 |
| 前端框架 | Next.js 16 + React 19 | `app/` 目录路由 |
| UI 组件 | shadcn/ui + Radix UI | 组件在 `components/ui/` |
| 样式 | Tailwind CSS 4 + tw-animate-css | 使用 `cn()` 合并类名（`lib/utils.ts`） |
| 图标 | lucide-react | 统一使用此图标库 |
| 状态管理 | Zustand 5 | Store 在 `stores/` 目录 |
| IPC 通信 | @egoist/tipc | 类型安全的主进程↔渲染层通信 |
| AI Agent | @anthropic-ai/claude-agent-sdk | Agent 会话、工具、技能 |
| 数据库 | better-sqlite3 | 本地 SQLite，schema 在 `electron/main/database/schema.sql` |
| Markdown | react-markdown + remark-gfm + rehype-highlight | 渲染 AI 回复 |
| 电子书解析 | epub2 / pdf-parse | EPUB 和 PDF 文件处理 |
| 网页解析 | @mozilla/readability + turndown + linkedom | 网络文章提取并转 Markdown |

---

## 项目结构概览

```
app/                    # Next.js 页面路由
components/             # React 组件
  ui/                   # shadcn/ui 基础组件
stores/                 # Zustand store
lib/                    # 前端工具
types/                  # 共享 TypeScript 类型定义
electron/
  main/
    index.ts            # Electron 入口，窗口管理
    agents/             # Agent 框架
    services/           # 业务逻辑
    database/           # SQLite 数据库
    tipc/               # IPC 路由
  preload/              # 预加载脚本
data/                   # SQLite 数据库文件
```

## 核心文件功能索引

### 页面路由（app/）
- `app/page.tsx` — 主工作区页面，三栏布局（对话列表 + AI助手 + 文件树/预览）
- `app/layout.tsx` — 根布局，全局元数据和字体配置
- `app/book/[id]/page.tsx` — 书籍阅读页面，章节导航 + AI问答/分析面板
- `app/agent-monitor/page.tsx` — Agent Worker 池状态监控仪表板
- `app/debug/page.tsx` — 开发调试窗口，集成 AgentChat 测试

### 业务组件（components/）
- `AgentChat.tsx` — AI 聊天核心组件，工具调用可视化、消息分叉、权限请求
- `WorkspaceExplorer.tsx` — 工作区文件树（@headless-tree/react），拖放/重命名/删除/新建
- `ArticlePreview.tsx` — 网络文章内容预览，选中文字浮动引用按钮
- `BookConversationList.tsx` — 对话列表，分叉标记，新建/删除对话
- `workspace-selector.tsx` — 工作区选择/创建界面
- `reader.tsx` — 电子书阅读器，章节导航 + 目录侧边栏 + AI面板
- `MarkdownRenderer.tsx` — Markdown 渲染器，GFM + 代码高亮
- `ToolBlock.tsx` — 工具调用块，可折叠显示工具输入/输出/状态
- `book-card.tsx` — 书籍卡片（封面、标题、作者、操作按钮）
- `book-list.tsx` — ⚠️ 已弃用，使用 WorkspaceExplorer 替代

### 状态管理（stores/）
- `workspace-store.ts` — 工作区状态：文件树、选中文件/书籍、文件操作（CRUD/移动）
- `article-store.ts` — 文章状态：选中文章、文章解析、URL 输入框
- `conversation-store.ts` — 对话状态：对话列表、选中对话、分叉参数、编辑重发
- `analysis-store.ts` — 书籍分析状态：分析进度、工具执行、章节处理
- `reference-store.ts` — 引用状态：引用文章列表、引用片段（用户选中文字）

### 工具函数（lib/）
- `client.ts` — tipc 客户端，window.ipcRenderer 通信入口
- `hooks.ts` — useBooks / useBook，书籍数据加载 Hook
- `utils.ts` — cn() 类名合并工具
- `events.ts` — tipc 事件处理入口，监听主进程事件（如分析进度）
- `sdk/index.ts` + `sdk/query.ts` — Claude Agent SDK 的 query 函数封装

### 类型定义（types/）
- `books.ts` — Book / Chapter / ChapterMetadata / BookAnalysis
- `article.ts` — ArticleMeta / Article / QuoteSnippet
- `ai.ts` — AIInteraction / AIMessage
- `agents.ts` — TaskStatus / TaskType / AgentTask / ForkParams
- `electron-api.ts` — Workspace / WorkspaceFileNode / ExtendedSessionMessage / Citation
- `electron.d.ts` — window.ipcRenderer 全局类型声明

### IPC 路由（electron/main/tipc/）
- `index.ts` — 路由注册中枢，聚合所有子路由
- `agent.ts` — Agent 会话管理（18个 RPC：创建/发送/关闭会话、书籍分析、权限控制）
- `ai.ts` — 通用 AI 接口（chat / summarize，占位实现）
- `book.ts` — 书籍内容查询（章节元数据、章节内容、阅读进度、文件路径）
- `article.ts` — 网络文章管理（抓取解析、列表、详情、删除）
- `conversations.ts` — 对话 CRUD + 分叉 + 分支（13个 RPC）
- `workspace.ts` — 工作区管理（列表、默认、文件夹选择、文件树）
- `file.ts` — 文件操作（选择文件、导入电子书、打开文件位置）
- `db.ts` — 数据库直接访问（书籍 CRUD）
- `explorer.ts` — 工作区文件树操作（创建/重命名/移动/复制/删除）
- `renderer-handlers.ts` — main→renderer 事件定义（分析更新、会话消息、权限请求等）

### 业务服务（electron/main/services/）
- `book-service.ts` — 电子书导入和预处理（文件复制、异步解析 TXT/EPUB/PDF）
- `ai-service.ts` — AI 接口占位（chat / summarize）
- `article-service.ts` — 网络文章抓取（readability + turndown → Markdown），微信公众号特殊处理
- `workspace-service.ts` — 工作区目录结构管理、元数据/分析结果读写
- `workspace-fs-service.ts` — 文件树扫描和文件系统操作（安全路径验证）
- `chapter-recognizer.ts` — 文本章节标题识别算法（5种模式匹配）

### Agent 框架（electron/main/agents/）
- `agent-manager.ts` — Worker 线程池管理器，任务队列调度，空闲 Worker 60s 自动回收
- `agent-worker.ts` — Worker 线程执行器，与 Claude Agent SDK 交互
- `query-based-session.ts` — 基于 query() 的会话（支持 resume/fork/skills/MCP/权限系统）
- `main-process-session.ts` — 主进程会话（SDK v2，unstable_v2_createSession）
- `task-types.ts` — 任务类型（SUMMARIZE/ANALYZE_BOOK/CHAT_SESSION/READING_ASSIST）和消息定义
- `logger.ts` — 日志工具（mainLogger / workerLogger / createTaskLogger）
- `tools/book-analysis-tools.ts` — 书籍分析工具（SaveAnalysis / SaveChapterAnalysis / MarkComplete）
- `tools/book-qa-tools.ts` — 书籍问答工具（SearchInChapters / AnswerQuestion，关键词搜索+相关度评分）
- `tools/article-tools.ts` — 文章阅读工具（ReadArticle / ListArticles）
- `skills/chat-skill.ts` — 对话技能（ChatSession / ChatSessionManager）

### 数据库（electron/main/database/）
- `schema.sql` — 8张表：books / chapters / workspaces / ai_interactions / conversations / conversation_messages / conversation_branches / branch_messages
- `index.ts` — 数据操作接口（dbBooks / dbChapters / dbAI / dbWorkspaces / dbConversations / dbConversationMessages / dbConversationBranches / dbBranchMessages）+ initDatabase() 含 v2-v5 迁移逻辑

### 关键数据流
- **IPC 通信**：Renderer → tipc.invoke() → Main tipc handler → service/database → renderer events 回传
- **Agent 执行**：Renderer → tipc.createQueryBasedSession → QueryBasedSession → query() SDK → MCP Tools → sessionMessage events → Renderer
- **书籍导入**：tipc.importBook → book-service.importBook → dbBooks.add + copyToWorkspace + preprocessBook(async) → 立即返回
- **工作区文件树**：workspace/getFiles → articleService.listArticleTree + workspaceFsService.scan + 数据库 bookId 标记 → 合并返回

---

## 关键开发约定

> IPC 通信、Agent 开发、前端组件、数据库的详细规则在 `.claude/rules/` 中按路径自动加载，此处只列全局约定。

### 状态管理（Zustand 5）

- Store 文件统一放在 `stores/` 目录
- 现有 Store：analysis-store, article-store, conversation-store, reference-store, workspace-store, settings-store
- 新增状态请创建独立的 store 文件，遵循现有命名模式 `xxx-store.ts`

### TypeScript 配置

- 前端（Next.js）：`tsconfig.json`，module=esnext，bundler 解析
- 主进程（Electron）：`tsconfig.electron.json`，module=ES2020，node 解析
- 路径别名：`@/*` 映射到项目根目录

---

## 禁止事项

- **不要**引入已有依赖能解决的重复库
- **不要**绕过 tipc 直接使用 ipcMain/ipcRenderer 通信
- **不要**在渲染层直接操作数据库，必须通过 IPC 调用主进程
- **不要**自行实现 Agent SDK 已提供的功能