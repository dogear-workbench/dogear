---
step: 1
title: 主进程窗口基建与广播
status: done
---

## 目标

主进程侧就绪：工作台窗口互斥广播、笔记单例窗口（含位置记忆）、数据中心窗口位置记忆、哨兵窗口 closed 恢复广播、新 RPC 与事件定义。完成后前端各步骤有事件可订阅、有窗口可打开。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无（首个 step）
- 当前关键文件状态：
  - `electron/main/main-app.ts:88-91` — dataCenterWindow / workbenchWindow 单例变量；`createDataCenterWindow`（231 行起，无位置记忆）、`createWorkbenchWindow`（262 行起，有 loadWindowBounds 位置记忆，可作模板）
  - `electron/main/tipc/windows.ts` — 现有 openDataCenterWindow / openWorkbenchWindow 两个 procedure
  - `electron/main/tipc/renderer-handlers.ts` — 事件类型集中定义处；参考 `sessionWindowClosed` 的注释风格
  - `electron/main/services/window-state-service.ts` — loadWindowBounds / saveWindowBounds，key 如 `workbench-window`
  - `electron/main/services/renderer-broadcast.ts` — broadcastToWindows
- 关键决策回顾：互斥状态不落盘；哨兵弹出 = tab 隐藏不卸载语义由前端管，主进程只发窗口生命周期事件

## 计划改动

- [ ] `renderer-handlers.ts` 新增事件定义：`workbenchWindowOpened/Closed`（payload null 或 `{}`）、`notesWindowOpened/Closed`、`dataCenterWindowOpened/Closed`、`notesTaskFocus`（`{ taskId, workspaceId }`，本 step 只定义，Step 5 发送）
- [ ] `main-app.ts`：
  - `createWorkbenchWindow` 成功创建后广播 `workbenchWindowOpened`；现有 `closed` 回调（325 行）加广播 `workbenchWindowClosed`
  - 新增 `createNotesWindow`（单例 + TitleBar 样式照 workbench + 位置记忆 key `notes-window` + loadURL `#/notes-window` + closed 置 null 并广播 `notesWindowClosed`）；创建成功广播 `notesWindowOpened`
  - `createDataCenterWindow` 加位置记忆（key `data-center-window`）+ opened/closed 广播
- [ ] `tipc/windows.ts` 新增 `openNotesWindow`（单例，已存在则 focus，照 openWorkbenchWindow）；新增 `getNotesWindowOpen`（返回笔记窗口是否存活，Step 5 分流用）
- [ ] 验证：`bun run build:electron` 通过；启动后手动调用（devtools console `window.ipcRenderer` 或临时按钮）openNotesWindow 能开窗（页面 404/空白正常，Step 3 才有页面）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 位置记忆逻辑从 createWorkbenchWindow 内联实现抽出为共享辅助 `createWindowWithBounds`（行为逐行保持一致），三窗口复用，避免三份重复代码
  - `createDataCenterWindow` 改为 async（位置记忆动态 import 所需），单例分支补了 minimize restore（与 workbench 对齐）；tipc 侧 openDataCenterWindow 补 await
  - 广播复用 renderer-broadcast.ts 的 `broadcastToWindows`（内置静默失败），未新造广播函数
- 改动文件清单：
  - `electron/main/tipc/renderer-handlers.ts` — 新增 7 个事件：workbenchWindowOpened/Closed、notesWindowOpened/Closed、dataCenterWindowOpened/Closed（payload null）、notesTaskFocus（{ taskId, workspaceId }，仅定义）
  - `electron/main/main-app.ts` — 新增 `createWindowWithBounds` 辅助；createWorkbenchWindow 重构为用它 + opened/closed 广播；createDataCenterWindow 加位置记忆（key `data-center-window`）+ 广播 + async 化；新增 notesWindow 变量 / `createNotesWindow`（key `notes-window`，hash `#/notes-window`）/ `getNotesWindow`；closeAllChildWindows 纳入 notesWindow
  - `electron/main/tipc/windows.ts` — 新增 `openNotesWindow`、`getNotesWindowOpen`（返回 `{ open: boolean }`）
- 验证：`bun run build:electron` ✓、`bun run lint` ✓（改动文件零告警）；临时 smoke 脚本（独立 userData，不影响运行中实例）验证：notes 窗口创建 ✓、单例幂等 focus ✓、closed 后引用清理 ✓、与其他窗口互不干扰 ✓（页面 404 为预期，Step 3 才有页面）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `createNotesWindow(): Promise<void>` / `getNotesWindow(): BrowserWindowType | null`（main-app.ts 导出）
  - tipc：`client.openNotesWindow()` → `{ success: true }`；`client.getNotesWindowOpen()` → `{ open: boolean }`
  - 事件（RendererHandlers，payload null 的用 `.send(null)`）：workbenchWindowOpened/Closed、notesWindowOpened/Closed、dataCenterWindowOpened/Closed、notesTaskFocus
  - 广播入口：`broadcastToWindows((h) => h.xxx.send(...))`（services/renderer-broadcast.ts）
- 下个 step 该从哪里继续：Step 2/3 前端订阅上述事件；笔记窗口页面路由 hash 为 `#/notes-window`（路由路径 /notes-window，需在 src/App.tsx 注册）；Step 5 focusTask 分流用 `getNotesWindowOpen` + `getNotesWindow()` 拿实例后 `webContents.focus()` + 直发 notesTaskFocus
- 待办或已知限制：
  - notesTaskFocus 主进程发送侧未接（按计划 Step 5 接线）
  - 笔记窗口默认尺寸取 1200×800（与数据中心一致，plan 未指定）；有位置记忆后用户自行调整
  - smoke 验证未覆盖真实渲染层广播接收（无页面可收事件），广播路径与 settingsChanged 同构风险低
