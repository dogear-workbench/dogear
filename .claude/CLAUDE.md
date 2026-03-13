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
| 前端构建 | Vite 7 | 开发服务器 + 构建（替代 Next.js） |
| 前端框架 | React 19 | 纯客户端 SPA |
| 路由 | React Router v7 | HashRouter（Electron file:// 兼容） |
| 包管理器 | Bun | 替代 npm，更快的安装和脚本执行 |
| UI 组件 | shadcn/ui + Radix UI | 组件在 `components/ui/` |
| 样式 | Tailwind CSS 4 + tw-animate-css | 使用 `cn()` 合并类名（`lib/utils.ts`） |
| 图标 | lucide-react | 统一使用此图标库 |
| 状态管理 | Zustand 5 | Store 在 `stores/` 目录 |
| IPC 通信 | @egoist/tipc | 类型安全的主进程↔渲染层通信 |
| AI Agent | @anthropic-ai/claude-agent-sdk | Agent 会话、工具、技能 |
| 数据存储 | JSON 文件 | `.dogear/` 目录下的 JSON 文件（settings/conversations/workspaces/书籍元数据） |
| Markdown | react-markdown + remark-gfm + rehype-highlight | 渲染 AI 回复 |
| 电子书解析 | epub2 / pdf-parse | EPUB 和 PDF 文件处理 |
| 网页解析 | @mozilla/readability + turndown + linkedom | 网络文章提取并转 Markdown |

---

## 项目结构概览

```
src/
  main.tsx              # Vite 入口，挂载 React
  App.tsx               # React Router 路由配置
  globals.css           # Tailwind CSS 4 全局样式
index.html              # Vite HTML 入口
vite.config.ts          # Vite 配置
app/                    # 页面组件（通过 React Router 而非文件系统路由）
components/             # React 组件
  ui/                   # shadcn/ui 基础组件
stores/                 # Zustand store
lib/                    # 前端工具
types/                  # 共享 TypeScript 类型定义
electron/
  main/
    index.ts            # Electron 入口，窗口管理
    agents/             # Agent 框架
    services/           # 业务逻辑（JSON 文件存储）
    tipc/               # IPC 路由
  preload/              # 预加载脚本
.dogear/                # 应用数据目录（settings.json, conversations.json, workspaces.json, conversations/）
```

## 核心文件功能索引

### 入口与路由（src/）
- `src/main.tsx` — Vite 入口，挂载 React 到 `#root`
- `src/App.tsx` — React Router 配置，HashRouter，定义所有路由
- `src/globals.css` — Tailwind CSS 4 全局样式

### 页面（app/）
- `app/page.tsx` — 主工作区页面，三栏布局（对话列表 + AI助手 + 文件树/预览）
- `app/book/BookPage.tsx` — 书籍阅读页面，章节导航 + AI问答/分析面板（useParams 获取 id）
- `app/agent-monitor/page.tsx` — Agent Worker 池状态监控仪表板
- `app/debug/page.tsx` — 开发调试窗口，集成 AgentChat 测试

### 业务组件（components/）
- `agent-chat/` — AI 聊天模块（从原 AgentChat.tsx 拆分）
  - `AgentChat.tsx` — 主组件（~180行），组合 hooks + 布局
  - `ChatInputArea.tsx` — 输入区域（引用芯片、图片预览、textarea、工具栏）
  - `MessageItem.tsx` — 单条消息渲染（用户/助手消息、分叉/编辑按钮）
  - `ContentBlockItem.tsx` — 内容块路由（text/tool_use/thinking/permission/askUser）
  - `ThinkingBlock.tsx` — 思考块（可折叠）
  - `AskUserQuestionCard.tsx` — AskUser 问题卡片（单选/多选）
  - `PermissionRequestCard.tsx` — 权限请求卡片（允许/拒绝/始终允许）
  - `CitationBadge.tsx` — 引用徽章
  - `types.ts` — 类型定义（ContentBlock、DisplayMessage 等）
  - `utils.ts` — 工具函数
  - `hooks/` — 自定义 hooks
    - `useAgentSession.ts` — 会话生命周期（创建/resume/fork/关闭）
    - `useSessionMessages.ts` — 消息流监听与流式更新
    - `useSessionEvents.ts` — 权限/AskUser/通知事件监听
    - `useMessageHistory.ts` — 历史消息加载与格式转换
    - `useImageAttachment.ts` — 图片附件（base64、粘贴、预览）
    - `useSendMessage.ts` — 消息发送、编辑重发、分叉、权限响应
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
- `conversations.ts` — 对话 CRUD + 分叉（8个 RPC，JSON 存储）
- `workspace.ts` — 工作区管理（列表、默认、文件夹选择、文件树）
- `file.ts` — 文件操作（选择文件、导入电子书、打开文件位置）
- `db.ts` — 书籍 CRUD（委托 book-service，JSON 存储）
- `explorer.ts` — 工作区文件树操作（创建/重命名/移动/复制/删除）
- `renderer-handlers.ts` — main→renderer 事件定义（分析更新、会话消息、权限请求等）

### 业务服务（electron/main/services/）
- `book-service.ts` — 电子书导入、预处理、JSON 元数据/章节存储（meta.json + chapters.json）
- `conversation-service.ts` — 对话索引 CRUD（`.dogear/conversations.json`），不存消息内容
- `workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`）
- `settings-service.ts` — 应用设置 JSON 存储（`.dogear/settings.json`）
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

### 数据存储（`.dogear/` 目录）
- `settings.json` — 应用设置（ModelProfile、Thinking 配置等）
- `workspaces.json` — 工作区索引（id、名称、路径、默认标记）
- `conversations.json` — 对话索引（id、标题、sdkSessionId、workspaceId、bookId、分叉信息）
- `conversations/` — SDK 会话历史（Agent SDK 自动管理）
- 书籍元数据：`<workspace>/<book>/meta.json` + `<workspace>/<book>/chapters.json`

### 关键数据流
- **IPC 通信**：Renderer → tipc.invoke() → Main tipc handler → service（JSON 文件读写） → renderer events 回传
- **Agent 执行**：Renderer → tipc.createQueryBasedSession → QueryBasedSession → query() SDK → MCP Tools → sessionMessage events → Renderer
- **书籍导入**：tipc.importBook → book-service.importBook → 写 meta.json + copyToWorkspace + preprocessBook(async) → 立即返回
- **工作区文件树**：workspace/getFiles → articleService.listArticleTree + workspaceFsService.scan + bookService bookId 标记 → 合并返回

---

## 关键开发约定

> IPC 通信、Agent 开发、前端组件的详细规则在 `.claude/rules/` 中按路径自动加载，此处只列全局约定。

### 数据存储（JSON 文件）

- 所有持久化数据使用 JSON 文件，不使用 SQLite
- 配置目录：`.dogear/`（开发: 项目根，打包: app.asar 同级）
- `getConfigDir()` 模式：参考 `settings-service.ts`
- 服务层统一使用 `fs.promises` 异步读写
- 内部用 camelCase，前端兼容层用 `toCompat()` 转 snake_case

### 状态管理（Zustand 5）

- Store 文件统一放在 `stores/` 目录
- 现有 Store：analysis-store, article-store, conversation-store, reference-store, workspace-store, settings-store
- 新增状态请创建独立的 store 文件，遵循现有命名模式 `xxx-store.ts`

### TypeScript 配置

- 前端（Vite）：`tsconfig.json`，module=esnext，bundler 解析
- 主进程（Electron）：`tsconfig.electron.json`，module=ES2020，node 解析
- 路径别名：`@/*` 映射到项目根目录

### 前端注意事项

- Vite 是纯 ESM 环境，**不能使用 `require()`**，必须用 `import()` 动态导入
- Store 之间避免循环依赖，如需延迟导入用 `await import('./xxx-store')`
- 新增页面需在 `src/App.tsx` 中添加 `<Route>` 配置
- 使用 HashRouter（非 BrowserRouter），因为 Electron 生产环境用 `file://` 协议

---

## 禁止事项

- **不要**引入已有依赖能解决的重复库
- **不要**绕过 tipc 直接使用 ipcMain/ipcRenderer 通信
- **不要**在渲染层直接操作文件系统，必须通过 IPC 调用主进程
- **不要**自行实现 Agent SDK 已提供的功能