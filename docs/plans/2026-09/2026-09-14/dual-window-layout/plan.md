# 双屏工作模式：多窗口排布体系 实施计划

**目标**：主窗口聚焦会话，右侧栏/笔记/数据中心以独立窗口形态弹出（互斥或弹出-恢复模式），通知点击跨窗口路由正确。

**架构思路**：各部分独立弹窗 + 用户自己组合，不做统一工具箱/一键开关/内部分屏。数据同步复用既有 broadcastToWindows 体系零新增；新增的只有 UI 意图跨窗口信号（互斥、弹出恢复、通知定位），照 focused-conversation-service / sessionWindowClosed 范例。设计全文见 [../2026-09-14-dual-window-layout-design.md](../2026-09-14-dual-window-layout-design.md)。

**涉及模块**：`electron/main/main-app.ts`、`electron/main/tipc/windows.ts`、`electron/main/tipc/renderer-handlers.ts`、通知点击链路（notification-center-service / tipc）、`app/page.tsx`、`components/WorkspaceTabBar.tsx`、`app/notes-window/page.tsx`（新）、`app/session-window/page.tsx`、`stores/session-store.ts`、`stores/ui-store.ts`、`components/agent-chat/AgentChat.tsx`

## 步骤索引

- [x] [Step 1: 主进程窗口基建与广播](./step1-main-infra.md) — 互斥广播、笔记单例窗口、数据中心窗口位置记忆、closed 恢复广播、新 RPC 与事件定义
- [x] [Step 2: 主窗口 header 改版与互斥响应](./step2-main-header.md) — header 左右分组/缩小/删刷新、右栏开关移位、互斥时右栏收起与按钮显隐、工作台按钮切换态
- [x] [Step 3: tab 栏改版与笔记窗口页面](./step3-tabbar-notes-window.md) — 哨兵 tab 右置+弹出按钮、笔记 tab 可开关+空态兜底、notes-window 页面（含任务定位监听）
- [x] [Step 4: 独立会话窗口改版](./step4-session-window.md) — 聊天+右栏布局、去文件树、互斥订阅
- [x] [Step 5: focusTask 通知分流](./step5-focus-task-routing.md) — 主进程通知点击分流到笔记窗口/主窗口

## 全局决策

- **事件命名**（renderer-handlers，camelCase）：`workbenchWindowOpened/Closed`、`notesWindowOpened/Closed`、`dataCenterWindowOpened/Closed`、`notesTaskFocus`（定位任务，payload `{ taskId, workspaceId }`）
- **互斥状态不落盘**：ui-store 加 `workbenchWindowOpen: boolean`（默认 false），由广播驱动更新；重启即单窗口态，无恢复逻辑
- **哨兵弹出态**：session-store 加 `notesWindowOpen` / `dataCenterWindowOpen`（广播驱动），弹出 = 哨兵 tab 从 tab 栏隐藏（tab 开关状态保留），关窗 = 恢复显示
- **笔记 tab 可开关**：`notesTabOpen` + localStorage（照 `dataCenterTabOpen` 模式，默认 true）；关闭所有 tab 后 `activeTabId = null` 走空态，不再兜底回笔记
- **窗口位置 key**：`notes-window` / `data-center-window`（window-state-service，照 `workbench-window` 用法）
- **写后即广播**：主进程窗口创建成功 / closed 时立即广播对应事件；广播内失败静默（窗口竞态由单例幂等 focus 自愈）
- **禁止**：窗口间直接通信、渲染层直操作文件系统、绕过 tipc 的 ipcMain/ipcRenderer
- 主进程改动需 `bun run build:electron` 后验证；前端 Vite 热重载

## 完成总结

2026-09-14 全部 5 步实施完成，逐 step 提交（04a6cec2 / b0e45445 / 6472c8a5 / ba81d2a6 / 见 git log step5）。产出：

- **主进程基建**：笔记单例窗口（位置记忆 `notes-window`）、数据中心位置记忆、三窗口 opened/closed 生命周期广播、notesTaskFocus 事件、openNotesWindow / getNotesWindowOpen / closeWorkbenchWindow / getWorkbenchWindowOpen RPC；位置记忆抽为共享辅助 createWindowWithBounds
- **主窗口**：header 紧凑化左右分组（删刷新、设置/消息左移）、右栏折叠钮移至最右、工作台互斥（开窗收右栏隐藏开关、按钮切换态）
- **tab 栏**：会话 tabs 左组可滚动，哨兵组（笔记/数据中心/文章）固定最右；哨兵 hover 弹出按钮，弹出中 tab 隐藏开关保留；笔记 tab 可开关 localStorage 记忆；全关走空态 EmptyFocusState 不再兑底回笔记（switchTab 收口防御覆盖 7+ 跳转入口）
- **笔记独立窗口**：`/notes-window` 页面复用 NotesPanel，监听 notesTaskFocus 切工作区+定位任务
- **独立会话窗口**：改为聊天+CompanionPanel 布局（去文件树），互斥同步右栏显隐，冷启动拉取互斥态；文章预览入聊天位+返回会话入口
- **通知分流**：任务通知点击 → 笔记窗口存活则前置+直发定位，否则主窗口现状不回归

遗留（均为一期范围外，详见各 step 交付文档）：弹出当前正看会话后主窗口 activeTabId 悬空（既有行为）；通知中心渲染层点击不走跨窗口路由；UI 视觉链路需 dev 人工确认。
