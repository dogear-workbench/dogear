# 设置回退页面覆盖 + 数据中心 tab 化 设计

**背景**：2026-08-26 窗口场景化重构把设置迁为独立窗口、数据中心做成独立窗口。实际使用后调整：设置不需要看其他内容，独立窗口过重；数据中心默认收在主窗口 tab 更顺手，但独立窗口链路保留（可提升）。

**目标**：
1. 设置回退为主窗口全屏 overlay（`e5af0ae` 之前的形态），拆除设置窗口全链路
2. 数据中心新增固定 tab（紧挨「笔记」右侧），header 按钮改为切 tab；tab 上保留「弹出为独立窗口」入口；独立窗口及其 IPC 链路不动

## 一、设置回退为页面覆盖

**架构**：恢复 `ui-store.settingsOpen` + App.tsx `fixed inset-0 z-50` 全屏 overlay，底层页面不卸载。

- `stores/ui-store.ts`：恢复 `settingsOpen / openSettings / closeSettings`（含 reset）
- `src/App.tsx`：恢复 overlay 渲染；删除 `/settings` 路由（无窗口加载）
- `app/page.tsx`：header「设置」按钮改 `openSettings`；删 `openSettingsWindow` 引用
- `app/settings/page.tsx`：
  - 返回按钮 → `closeSettings()`
  - `handleClose` / `handleSaveAndRestart` 等处的 `client.forceCloseSettingsWindow()` → `closeSettings()`
  - 删 `settingsCloseRequested` 监听
  - dirty 三按钮拦截（放弃/保存/保存并重启）逻辑保留，仅「关闭」动作改为关 overlay
- `stores/workspace-store.ts`：删 `openSettingsWindow` 及对应 IPC 调用

**主进程拆除**：
- `electron/main/index.ts`：`settingsWindow`、`createSettingsWindow`、close guard、`requestCloseSettingsWindow`、`forceCloseSettingsWindow`、`settingsSkipCloseGuard` 全删
- `electron/main/tipc/windows.ts`：删 `openSettingsWindow` / `requestCloseSettingsWindow` / `forceCloseSettingsWindow` 三个 IPC；`openDataCenterWindow` 保留
- `electron/main/tipc/renderer-handlers.ts`：删 `settingsCloseRequested`
- `electron/main/tipc/index.ts`：相应清理

**保留不动**：`updateSettings` 落盘后 `broadcastSettingsChanged` → 主窗口 `setup-settings-sync` 监听 `loadSettings + restartActiveSessions`。设置回到主窗口后链路天然成立（主进程发给自己窗口），零改动。

## 二、数据中心 tab 化

**架构**：与「首页/笔记」同构的固定哨兵 tab，常驻挂载 display 切换。

- `stores/session-store.ts`：新增 `export const DATA_CENTER_TAB_ID = '__data_center__'`（纯哨兵，无需 state）
- `components/WorkspaceTabBar.tsx`：「笔记」右侧加固定 tab「数据中心」（Database 图标 + `group` hover 显示 ExternalLink 弹出按钮，点击 `client.openDataCenterWindow()` 复用单例窗口）
- `app/page.tsx`：内容区加 `<div className="absolute inset-0 flex flex-col" style={{ display: activeTabId === DATA_CENTER_TAB_ID ? 'flex' : 'none' }}><DataCenterPage /></div>`；header「数据中心」按钮改为 `switchTab(DATA_CENTER_TAB_ID)`
- `app/data-center/page.tsx`：根容器 `h-screen` → `h-full`
- `src/App.tsx`：`/data-center` 路由外包 `<div className="h-screen">` 壳，独立窗口整页高度不变

**已接受的代价**：
- tab 常驻挂载 → 主窗口启动即 SchedulerPanel 分钟级轮询（只读 IPC，量小可接受）
- tab 与独立窗口同时打开是两个实例，两边同时编辑同一定时任务会后保存者覆盖（边缘情况不处理）

**错误处理 / 边界情况**：
- 弹出独立窗口后 tab 内容继续挂载，无窗口关闭联动事件（窗口关了 tab 数据由自身轮询自然刷新）
- `switchTab` 哨兵值与 `HOME_TAB_ID` / `NOTES_TAB_ID` 同机制，`closeTab` 不会误伤哨兵（tabs 数组不含哨兵）

**未决问题**：无
