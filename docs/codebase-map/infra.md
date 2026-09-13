# 基础设施域（infra）

入口路由、IPC 总览、lib、类型、.dogear 存储、测试基建，及不属于任何功能域的横切 UI 与服务（兜底）。

## 入口与路由

- `src/main.tsx` — Vite 入口：挂载 React，顶层挂 setupSettingsSync（动态 import 防非主窗口副作用）
- `src/App.tsx` — HashRouter 路由（`/` 主工作区、`/session-window/:id`、`/data-center`、`/workbench-window`、`/stocks`、`/wechat`、`/debug`）+ 设置全屏 overlay + ConfirmDialog + Toaster
- `src/globals.css` — Tailwind CSS 4 全局样式
- `electron/main/index.ts` — 主进程入口：窗口创建与生命周期（主窗口+各子窗口 `${getRendererPath()}#/路由` 拼接）、`app://` 自定义协议（standard+secure，字体扩展名显式 MIME 映射，路径穿越防护）、broadcastSettingsChanged 定向发主窗口
- `app/debug/page.tsx` — 开发调试窗口（AgentChat 测试）

## IPC 总览（electron/main/tipc/）

- `index.ts` — 路由注册中枢，聚合全部子路由
- `windows.ts` — 窗口管理路由：数据中心/伴随工作台单例窗口（BrowserWindow 单例在 electron/main/index.ts）
- `focus.ts` — 全局焦点会话上报/拉取（写 focused-conversation-service，值变化才广播）
- `pty.ts` — PTY 路由 + registerPtyBroadcaster（pty-service 事件桥接为 ptyCreated/ptyData/ptyExit 广播）
- `browser.ts` — 浏览器路由 + 动作流/呈现/等待人工接线（registerBrowserActionBridge）
- `agent.ts` — Agent 会话管理路由：setSessionModel（同 profile 换 tier 快速路径/跨 profile needsRestart）、closeQueryBasedSession=release 语义 vs forceClose=强杀、pauseQueryBasedSession=turn 粒度暂停受理；complete 分支挂 failover 钩子；handleSessionNotification 系统提示决策单点（complete/failed/permission 过滤链+提示音）
- `ai.ts` + `services/ai-service.ts` — 通用 AI 接口占位（chat/summarize）
- `article.ts` / `notes.ts` / `tasks.ts` — 文章 / 笔记 CRUD / 协作任务路由（详见各功能域）
- `notifications.ts` — 消息中心路由（notification-center-service 单例透传，变更经广播推送）
- `conversations.ts` — 对话 CRUD+分叉
- `workspace.ts` / `file.ts` / `explorer.ts` — 工作区管理 / 打开文件位置 / 文件树操作
- `stock.ts` / `usage.ts` / `group.ts` / `ability.ts` / `scheduler.ts` — 股票 12+RPC / 用量查询 / 会话组+话题+共享区 / 能力包（getAbilityPacks 四源聚合+getAbilityMounts）/ 定时任务
- `renderer-handlers.ts` — main→renderer 事件定义收口（sessionMessage、权限请求、usageEntryAdded、sessionStateChanged/sessionClosed、aliveConversationsChanged、failoverNotice、tasksChanged、notificationsChanged、soundCue、pty 三事件、browserActionAdded、pagePresentationChanged、humanInterventionChanged 等）

## lib（src/lib/）

- `client.ts` — tipc 客户端（window.ipcRenderer 通信唯一入口）
- `events.ts` — tipc 事件处理入口（监听主进程广播）
- `utils.ts` — cn() 类名合并
- `dogear-sound.ts` — Web Audio 合成提示音（complete/permission/error 三音型、enabled 开关、1200ms 节流、backgroundOnly）
- `sdk/index.ts` + `sdk/query.ts` — Claude Agent SDK query 函数封装
- `pi-model-catalog.ts` — model-catalog 渲染层同源副本（tsconfig 隔离与主进程无法共享文件）

## 类型（src/types/）

- `electron-api.ts` — Workspace/WorkspaceFileNode/ExtendedSessionMessage/Citation/Conversation（含 contractMetadata 派遣溯源）
- `electron.d.ts` — window.ipcRenderer 全局声明
- `ai.ts` — AIInteraction/AIMessage（占位接口配套）
- 其余分域：article/note/task → articles.md；agents/delegation → agent-core.md；settings → settings.md；stock → stocks.md；usage/scheduler → data-center.md

## 横切 UI 与服务（兜底）

- `components/MarkdownRenderer.tsx` — Markdown 渲染器（GFM+代码高亮；p/li 文本仅搜索高亮，正文不识别路径；可选 baseDir 解析相对链接）
- `components/ConfirmDialog.tsx` + `stores/confirm-store.ts` — 全局确认弹窗（confirm() 返回 Promise，showConfirm() 简化版；禁用 window.confirm）
- `components/TitleBar.tsx` — 全窗口自绘标题栏（pointer-events-none 点击穿透到全局 drag 层，z-9998 低于 drag 层）
- `components/NotificationCenter.tsx` + `stores/notification-store.ts` — 顶栏消息中心（未读徽章、邮箱式面板、点击跳转即已读；仅主窗口）
- `services/notification-center-service.ts` — 通知聚合存储（`.dogear/notifications.json` 全局一份；同源未读聚合 dedupeKey、上限 100 条、写点广播 notificationsChanged）
- `stores/ui-store.ts` — UI 状态：设置 overlay 开关 + 右侧面板折叠
- `services/renderer-broadcast.ts` — 主进程→渲染层广播收口（conversationListChanged immediate/500ms 去抖两档、groupDataChanged）
- `services/safe-json.ts` — 安全 JSON 存储（原子写+备份+互斥锁），各存储通用
- `services/window-state-service.ts` — 窗口位置记忆（`.dogear/window-state.json`，当前仅伴随工作台用）
- `agents/logger.ts` — 日志工具（mainLogger/workerLogger/createTaskLogger）

## 数据存储（`.dogear/` 目录）

- `settings.json` / `notifications.json` / `workspaces.json` — 应用设置 / 消息中心 / 工作区索引
- `conversations.json` — 对话索引（id/标题/sessionId/workspaceId/groupId/role/分叉/modelSelection/usageSummary）
- `plans.json` — 定时任务（version:2 容器一行一任务；builtin 存量过滤隐藏）
- `run-history/YYYY-MM.jsonl` — 计划运行历史（按月，保留 3 个月）
- `tasks.json` — 协作任务（version 2，读时迁移 v1）
- `usage/{conversationId}.jsonl` — 会话 token 用量明细
- `conversations/` — 旧 SDK 主会话历史（只读归档备份，不再回放）
- `workspaces/{id}/sessions/` — Harness 会话 JSONL（pi-session-repository 管理，conversations.json 的 sessionId 指向这里）
- `workspaces/{id}/notes/` — 笔记卡片（一卡一 md，文件为真源）
- `workspaces/{id}/groups/{gid}/background.md` — 话题状态卡（结构见 data-center.md）
- `workspaces/{id}/groups/{gid}/shared/` — 组共享区（`_notes/` 放阶段总结）；同目录 `digest.md` 为旧提炼链路遗留数据（已停止读写）
- `workspaces/{id}/dashboard.md`、`smart-categories.json`、`digests/_archive/` — 已下线链路遗留数据（文件保留，不再读写）
- `skills/` — 全局 custom skills；`article-parser/` — 文章解析 skills 运行时目录
- `site-knowledge/{domain}.md` — 站点档案（两区：正式地图+探索发现）
- `stocks/watchlist.json` / `formulas.json` / `kline/` / `daily/` / `announcements/` / `cninfo-org-map.json` — 自选股/公式/K线/每日快照/公告缓存/巨潮 orgId 映射（结构见 stocks.md）
- `window-state.json` — 窗口位置记忆

## 测试基建（resources/ 及散布单测）

- `resources/browser-eval/` — 浏览器模块冒烟脚本集：runner 一律 node 执行，跑前先 build:electron（从 dist 导入）；`DOGEAR_CONFIG_DIR` 临时目录隔离；site-policy/extension-ownership/nm-protocol/nm-navigate/nm-read-state/nav-tracker/stale-protocol/profile-migration/site-knowledge/extension-site-tools 十脚本
- `electron-hooks.mjs` + `electron-stub.mjs` — node 环境 import dist 所需的 electron 模块 mock（module register hook）
- 内嵌浏览器链路回归：`DOGEAR_EMBEDDED_BROWSER_SELFTEST=1 bunx electron .` 运行时自测
- 单测散布源码旁（bun test）：ability-registry.test.ts、turns.test.ts、usage-utils、bigmodel-mcp mock 协议测试等

## 注意

- 渲染层不直接操作文件系统，一律经 tipc（`lib/client.ts`）；不得绕过 tipc 直接用 ipcMain/ipcRenderer
- 禁用 window.confirm/window.prompt，统一 showConfirm()
- Vite 前端为纯 ESM 环境，动态导入用 `import()`，不可用 `require()`
- `app://` 协议下 `.ttf` 等字体需显式 `font/ttf` MIME，否则 @font-face 拒载

## 数据流

- IPC 通信：Renderer → tipc.invoke() → Main tipc handler → service（JSON 文件读写）→ renderer events 回传
