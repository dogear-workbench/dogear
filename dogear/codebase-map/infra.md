# 基础设施域（infra）

入口路由、IPC 总览、lib、类型、.dogear 存储、测试基建，及不属于任何功能域的横切 UI 与服务（兜底）。

## 入口与路由

- `src/main.tsx` — Vite 入口：挂载 React，顶层挂 setupSettingsSync（动态 import 防非主窗口副作用）
- `src/App.tsx` — HashRouter 路由（`/` 主工作区、`/session-window/:id`、`/data-center`、`/workbench-window`、`/notes-window`）+ 设置全屏 overlay + ConfirmDialog + Toaster
- `src/globals.css` — Tailwind CSS 4 全局样式
- `electron/main/index.ts` — 进程入口：仅分流（`--nm-host-bridge` 参数走 NM host worker，否则动态 import main-app）
- `electron/main/main-app.ts` — 主进程入口真身：app 生命周期、单实例锁、`app://` 协议（standard+secure，字体扩展名显式 MIME 映射，路径穿越防护）、托盘、broadcastSettingsChanged 定向发主窗口；启动时注入 configDir 并迁移工作区数据（旧工作区 `.dogear/` → configDir/workspaces/{wsid}/，workspace-data-migration.ts 幂等，失败仅 log 不阻塞）；子窗口工厂与查询经 window-factories facade re-export
- `electron/main/window-factories.ts` — 窗口工厂：主窗口与各子窗口（数据中心/伴随工作台/笔记/会话窗口，`${getRendererPath()}#/路由` 拼接）
- `electron/main/tray.ts` — 系统托盘

## IPC 总览（electron/main/tipc/）

- `index.ts` — 路由注册中枢，聚合全部子路由
- `windows.ts` — 窗口管理路由：数据中心/伴随工作台单例窗口（BrowserWindow 单例在 electron/main/index.ts）
- `focus.ts` — 全局焦点会话上报/拉取（写 focused-conversation-service，值变化才广播）
- `pty.ts` — PTY 路由 + registerPtyBroadcaster（pty-service 事件桥接为 ptyCreated/ptyData/ptyExit 广播）
- `browser.ts` — 浏览器路由 + 动作流/呈现/等待人工接线（registerBrowserActionBridge）+ `browser:openExternal`（应用内 http/https 外链统一出口，shell.openExternal 系统浏览器）
- `agent.ts` — Agent 会话管理路由：setSessionModel（同 profile 换 tier 快速路径/跨 profile needsRestart）、closeQueryBasedSession=release 语义 vs forceClose=强杀、pauseQueryBasedSession=turn 粒度暂停受理；complete 分支挂 failover 钩子；handleSessionNotification 系统提示决策单点（complete/failed/permission 过滤链+提示音）
- `feishu.ts` — 飞书 Bot 路由（唯一 Bot 渠道，微信 Bot 已删）：getConfig/saveConfig/clearConfig/testConnection/connect/disconnect/getConnectionStatus/getBotStatus/botUseConversation/openPlatform/createTopicChat（替换语义：建新群前清旧群三层绑定）/resetTopicChat（原地重置：清绑定重发管理卡不建新群）/setNotifyPush 十三条 + autoConnectFeishu 启动自动重连（connect/autoConnect 挂 feishuNotifyOutlet、disconnect 摘除）；registerBotStateGetter 多注册（agent.ts getter 数组）
- `article.ts` / `notes.ts` / `tasks.ts` — 文章 / 笔记 CRUD / 协作任务路由（详见各功能域）
- `notifications.ts` — 消息中心路由（notification-center-service 单例透传，变更经广播推送）
- `conversations.ts` — 对话 CRUD+分叉+移入工作区（moveConversationToWorkspace：索引迁移+session 搬运）
- `workspace.ts` / `file.ts` / `explorer.ts` / `git.ts` — 工作区管理 / 打开文件位置 / 文件树操作 / git 历史（能力检测+双源时间线+快照恢复+历史版本内容）
- `usage.ts` / `group.ts` / `ability.ts` / `scheduler.ts` — 用量查询 / 会话组+话题+共享区 / 能力包（getAbilityPacks 四源聚合+getAbilityMounts）/ 定时任务
- `settings.ts` / `workspace-config.ts` / `skill.ts` / `claude-config.ts` — 设置读写 / 工作区能力配置+会话联动 / skill 列表与自定义技能读取·编辑·导入 / agent.md 与 .claude/agents 管理
- `updater.ts` / `environment.ts` / `log.ts` — 应用更新 / 环境依赖检测+Python 依赖安装 / 渲染层日志转发
- `assets.ts` / `shunt.ts` / `delegation.ts` / `conversation-runtime.ts` / `memory.ts` — 习得资产（平台脚本+站点档案）/ 分流执行+continueConversation / 子会话派遣状态（桥 delegation-bridge）/ 会话运行时附着 / 主题记忆五路由
- `backup.ts` / `sync.ts` — 应用数据备份路由（状态/手动备份/列表/快照还原/打开 backups/ 根目录）/ 设备同步路由（状态/getPeersSnapshot 合并快照/scanPeers 寻找设备/配对/unpair 解除配对/手动同步/同步状态读写；两域服务见 data-center.md）
- `renderer-handlers.ts` — main→renderer 事件定义收口（sessionMessage、权限请求、usageEntryAdded、sessionStateChanged/sessionClosed、aliveConversationsChanged、failoverNotice、tasksChanged、notificationsChanged、soundCue、pty 三事件、browserActionAdded、pagePresentationChanged、humanInterventionChanged、feishuConnectionStatus/feishuBotAutoInit/feishuBotBindingChanged 等）

## lib（src/lib/）

- `client.ts` — tipc 客户端（window.ipcRenderer 通信唯一入口）
- `events.ts` — tipc 事件处理入口（监听主进程广播）
- `utils.ts` — cn() 类名合并
- `open-external.ts` — openExternalUrl(url)：渲染层 http(s) 外链统一走 `browser:openExternal` 系统浏览器打开（Electron 的 window.open 只会开应用内裸窗口，禁用）
- `line-diff.ts` — LCS 行级 diff 纯函数（公共前后缀裁剪；>20000 行返回 null 降级），文件历史面板用
- `hotkey-registry.ts` — 全局快捷键 registry：HOTKEY_DEFS 静态定义 + registerHotkey(id, handler)（共享单 listener + 引用计数）+ listHotkeys（设置页清单数据源）；组件挂载时注册、卸载即解绑
- `dogear-sound.ts` — Web Audio 合成提示音（complete/permission/error 三音型、enabled 开关、1200ms 节流、backgroundOnly）
- `pi-model-catalog.ts` — model-catalog 渲染层同源副本（tsconfig 隔离与主进程无法共享文件）

## 类型（src/types/）

- `electron-api.ts` — Workspace/WorkspaceFileNode/ExtendedSessionMessage/Citation/Conversation（含 contractMetadata 派遣溯源；字段均为 camelCase，无兼容层）
- `electron.d.ts` — window.ipcRenderer 全局声明
- `group.ts` / `notification.ts` — Group 数据模型（主进程 types.ts 镜像）/ 消息中心条目类型
- 其余分域：article/note/task → articles.md；delegation → agent-core.md；settings → settings.md；stock → stocks.md；usage/scheduler → data-center.md

## 横切 UI 与服务（兜底）

- `components/MarkdownRenderer.tsx` — Markdown 渲染器（GFM+代码高亮；p/li 文本仅搜索高亮；可选 baseDir 解析相对链接；dogear:// 会话跳转链接劫持 + urlTransform 放行；extraRoots 可选追加候选根（附加根之后），配合 sharedGroupId 供聊天链路识别组共享区文件；行内 code 内容为单一存在路径时脱壳直接渲染胶囊）
- `components/ConfirmDialog.tsx` + `stores/confirm-store.ts` — 全局确认弹窗（confirm() 返回 Promise，showConfirm() 简化版；禁用 window.confirm）
- `components/TitleBar.tsx` — 无 TopBar 窗口面（数据中心独立窗口、主窗口无工作区兜底态）的顶部拖拽条：整条 app-region drag + WCO 右避让，title 可选；主窗口常规布局不用（拖拽由 TopBar 分区承担）
- 窗口拖拽架构：主窗口 = TopBar 根 drag + 按钮 no-drag 分区（TopBar 挂载时给 html 加 has-topbar，globals.css `#root::before` 全局层随之失效）；其余 WCO 窗口 = `#root` padding-top 让位 + `#root::before` 全局 drag 层（app-region 元素不能 pointer-events-none，否则不参与命中失去拖拽）；Windows 子窗口页内建 drag 条后删全局层属二期
- `components/NotificationCenter.tsx` + `stores/notification-store.ts` — 主窗口 TopBar 消息中心（未读徽章、邮箱式面板、点击跳转即已读；仅主窗口）
- `services/notification-center-service.ts` — 通知聚合存储（`.dogear/notifications.json` 全局一份；同源未读聚合 dedupeKey、上限 100 条、写点广播 notificationsChanged）；onAdd 出口在落盘后同步分发（listener 异常隔离，飞书推送出口经此挂载，service 不反向依赖 feishu 模块）
- `stores/ui-store.ts` — UI 状态：设置 overlay 开关 + 对话列表开合 + 笔记时间线折叠 + 右侧面板开合/tab + 工作台窗口互斥态（广播驱动）
- `services/renderer-broadcast.ts` — 主进程→渲染层广播收口（broadcastToWindows 全窗口遍历 + conversationListChanged immediate/500ms 去抖两档 + groupDataChanged + aliveConversations）；renderer-broadcast-lazy.ts 为懒加载包装（避免模块加载期依赖 electron）
- `services/safe-json.ts` — 安全 JSON 存储（原子写+备份+互斥锁），各存储通用
- `services/data-registry.ts` — 应用数据字典与清单（字典单一来源在 data-items.ts 纯模块，此处 re-export + 保留 node 侧路径引擎；backup-service/sync/push-guard 均从它取源，详见 data-center.md）
- `services/backup-service/zip-pack-worker.ts` — zip 打包 worker 线程入口：主进程反解+stat 产条目，worker 纯打包（60s 超时）失败回退主进程分片，保大目录备份不冻结 UI；worker 产物经 electron-builder dist/** 自动打入
- `services/window-state-service.ts` — 窗口位置记忆（`.dogear/window-state.json`，当前仅伴随工作台用）
- `services/update-service.ts` + `services/update-manifest.ts` / `tipc/updater.ts` / `update-server/`（update-*.zip、latest.yml、manifest.json）/ `scripts/serve-updates.mjs`·`release.mjs` — 应用自动更新体系整链：更新下载安装与清单类型、更新路由、发布产物与发布/本地分发脚本
- `services/bigmodel-mcp-service.ts` — GLM Coding Plan MCP 客户端（手写 JSON-RPC over HTTP：web_search_prime/web_reader；agents/tools/web-mcp-tools.ts 的后端）
- `services/custom-resources-migration.ts` — custom/ 统一自定义区一次性迁移（skills/ → custom/skills/ + 话题状态卡死文件清理）
- `services/tool-usage/tool-usage-service.ts` — 工具调用记录（`.dogear/tool-usage/tool-usage-YYYY-MM-DD.jsonl` 按日追加；recordToolUsage 同步 append，失败当日熔断静默不阻断工具执行；cleanupOldToolUsage 保留 90 天，挂启动链路；字段含 tool/pack/conv/sessionType/profile/ws/ok/ms）
- `lib/failover-markers.ts` — failover 展示契约渲染层镜像（哨兵前缀/quota 关键词与主进程 model-failover/delegation-terminal 对齐）
- `agents/logger.ts` — 日志工具（mainLogger/workerLogger/createTaskLogger）

## 数据存储（configDir：开发模式 = 项目 `.dogear/`，安装版 = 系统应用数据目录）

> configDir 整体挂载进会话文件边界（`pi-session/workspace-paths.ts` 唯一计算来源），顶层禁写清单同文件；notes/memory 等应用数据由 dogear__* 工具写，模型直写被拦截。

- `settings.json` / `notifications.json` / `workspaces.json` — 应用设置 / 消息中心 / 工作区索引
- `conversations.json` — 对话索引（id/标题/sessionId/workspaceId/groupId/role/分叉/modelSelection/usageSummary）
- `plans.json` — 定时任务（version:2 容器一行一任务，只认新格式）
- `run-history/YYYY-MM.jsonl` — 计划运行历史（按月，保留 3 个月）
- `usage/{conversationId}.jsonl` — 会话 token 用量明细
- `workspaces/{id}/sessions/<sessionId>/` — pi-durable 会话目录（main.jsonl 主体 + session.json 元数据 + doc-*.jsonl 附件；storage-migrator 迁移存量平铺 JSONL，pi-session-repository 管理，conversations.json 的 sessionId 指向这里）
- `workspaces/{id}/tasks.json` — 协作任务（version 3，读时链式迁移 v1→v2→v3；已从工作区 `<ws>/.dogear/tasks.json` 迁入，启动迁移见 workspace-data-migration.ts）
- `workspaces/{id}/articles/` — 文章库（每篇 UUID 目录 meta.json+原文；已从工作区 `<ws>/.dogear/articles` 迁入，树 path 保留旧虚拟前缀，物理路径唯一入口 workspace-data-root.ts）
- `workspaces/{id}/notes/` — 笔记卡片（一卡一 md，文件为真源；已从项目工作区 `<ws>/.dogear/notes` 迁入）
- `workspaces/{id}/memory/` — 主题记忆（结构见 data-center.md，迁移同上）
- `workspaces/{id}/groups/{gid}/shared/` — 组共享区（`_notes/` 放阶段总结）；同目录 `digest.md`/`background.md`/`CONTEXT.md` 为旧链路遗留数据（已停止读写，只读残留不清理）
- `workspaces/{id}/dashboard.md`、`smart-categories.json`、`digests/_archive/` — 已下线链路遗留数据（文件保留，不再读写）
- `custom/skills/` — 全局自定义 skill（custom-resources-migration 一次性迁入统一自定义区）；`custom/browser-extensions/` — 扩展 custom 副本；`article-parser/` — 文章解析 skills 运行时目录
- `site-knowledge/{domain}.md` — 站点档案（两区：正式地图+探索发现）
- `stocks/watchlist.json` / `formulas.json` / `kline/` / `daily/` / `announcements/` / `cninfo-org-map.json` — 自选股/公式/K线/每日快照/公告缓存/巨潮 orgId 映射（结构见 stocks.md）
- `backups/<scope>/` — 应用数据备份 zip（分类-时间戳命名）；`backups/last-run.json` — 备份执行观测；两者均为 registry 排除项，不参与备份与同步
- `feishu/config.json` — 飞书 Bot 凭证与状态（appId/appSecret/botName/connectedAt/userOpenId?/topicChatId?/notifyPush?，明文）；`feishu/threads.json` — v2 三层 binding（chatBindings 群→group 含管理卡 id / threadBindings 话题→会话一对一 / pendingBindings 待绑定 TTL 10 分钟，v1 数据不迁移）
- `window-state.json` — 窗口位置记忆

## 测试基建（resources/ 及散布单测）

- `resources/browser-eval/` — 浏览器模块冒烟脚本集：runner 一律 node 执行，跑前先 build:electron（从 dist 导入）；`DOGEAR_CONFIG_DIR` 临时目录隔离；site-policy/extension-ownership/nm-protocol/nm-navigate/nm-read-state/nav-tracker/stale-protocol/profile-migration/site-knowledge/extension-site-tools 十脚本
- `electron-hooks.mjs` + `electron-stub.mjs` — node 环境 import dist 所需的 electron 模块 mock（module register hook）
- 单测散布源码旁（bun test）：ability-registry.test.ts、turns.test.ts、usage-utils、bigmodel-mcp mock 协议测试等
- `scripts/chat-render-benchmark.ts` / `scene-overview-smoke.ts` — 聊天渲染基准 / 场景总览冒烟脚本
- `scripts/dump-tool-groups.test.ts` — 工具清单快照 dump（mock electron 跑 getAllToolGroups，内置各组非空断言）；改 tools/ 目录后跑 `DOGEAR_DUMP_OUT=<文件> bun test scripts/dump-tool-groups.test.ts` 拿快照与改动前 diff 验证等价；不传参时写临时目录不落盘

## 注意

- 渲染层不直接操作文件系统，一律经 tipc（`lib/client.ts`）；不得绕过 tipc 直接用 ipcMain/ipcRenderer
- 禁用 window.confirm/window.prompt，统一 showConfirm()
- Vite 前端为纯 ESM 环境，动态导入用 `import()`，不可用 `require()`
- `app://` 协议下 `.ttf` 等字体需显式 `font/ttf` MIME，否则 @font-face 拒载

## 数据流

- IPC 通信：Renderer → tipc.invoke() → Main tipc handler → service（JSON 文件读写）→ renderer events 回传
