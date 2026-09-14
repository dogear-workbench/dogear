# 双屏工作模式：多窗口排布体系 实施计划

**目标**：主窗口聚焦会话，右侧栏/笔记/数据中心以独立窗口形态弹出（互斥或弹出-恢复模式），通知点击跨窗口路由正确。

**架构思路**：各部分独立弹窗 + 用户自己组合，不做统一工具箱/一键开关/内部分屏。数据同步复用既有 broadcastToWindows 体系零新增；新增的只有 UI 意图跨窗口信号（互斥、弹出恢复、通知定位），照 focused-conversation-service / sessionWindowClosed 范例。设计全文见 [../2026-09-14-dual-window-layout-design.md](../2026-09-14-dual-window-layout-design.md)。

**涉及模块**：`electron/main/main-app.ts`、`electron/main/tipc/windows.ts`、`electron/main/tipc/renderer-handlers.ts`、通知点击链路（notification-center-service / tipc）、`app/page.tsx`、`components/WorkspaceTabBar.tsx`、`app/notes-window/page.tsx`（新）、`app/session-window/page.tsx`、`stores/session-store.ts`、`stores/ui-store.ts`、`components/agent-chat/AgentChat.tsx`

## 步骤索引

- [x] [Step 1: 主进程窗口基建与广播](./step1-main-infra.md) — 互斥广播、笔记单例窗口、数据中心窗口位置记忆、closed 恢复广播、新 RPC 与事件定义
- [x] [Step 2: 主窗口 header 改版与互斥响应](./step2-main-header.md) — header 左右分组/缩小/删刷新、右栏开关移位、互斥时右栏收起与按钮显隐、工作台按钮切换态
- [ ] [Step 3: tab 栏改版与笔记窗口页面](./step3-tabbar-notes-window.md) — 哨兵 tab 右置+弹出按钮、笔记 tab 可开关+空态兜底、notes-window 页面（含任务定位监听）
- [ ] [Step 4: 独立会话窗口改版](./step4-session-window.md) — 聊天+右栏布局、去文件树、互斥订阅
- [ ] [Step 5: focusTask 通知分流](./step5-focus-task-routing.md) — 主进程通知点击分流到笔记窗口/主窗口

## 全局决策

- **事件命名**（renderer-handlers，camelCase）：`workbenchWindowOpened/Closed`、`notesWindowOpened/Closed`、`dataCenterWindowOpened/Closed`、`notesTaskFocus`（定位任务，payload `{ taskId, workspaceId }`）
- **互斥状态不落盘**：ui-store 加 `workbenchWindowOpen: boolean`（默认 false），由广播驱动更新；重启即单窗口态，无恢复逻辑
- **哨兵弹出态**：session-store 加 `notesWindowOpen` / `dataCenterWindowOpen`（广播驱动），弹出 = 哨兵 tab 从 tab 栏隐藏（tab 开关状态保留），关窗 = 恢复显示
- **笔记 tab 可开关**：`notesTabOpen` + localStorage（照 `dataCenterTabOpen` 模式，默认 true）；关闭所有 tab 后 `activeTabId = null` 走空态，不再兜底回笔记
- **窗口位置 key**：`notes-window` / `data-center-window`（window-state-service，照 `workbench-window` 用法）
- **写后即广播**：主进程窗口创建成功 / closed 时立即广播对应事件；广播内失败静默（窗口竞态由单例幂等 focus 自愈）
- **禁止**：窗口间直接通信、渲染层直操作文件系统、绕过 tipc 的 ipcMain/ipcRenderer
- 主进程改动需 `bun run build:electron` 后验证；前端 Vite 热重载
