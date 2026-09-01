# UI 打磨一轮：右侧栏归属 / 数据中心可关闭 / 面板裁底 / 首页并入笔记 / 统一自绘标题栏

**日期**：2026-09-01
**背景**：伴随工作台一期上线后的使用反馈，5 项独立 UI/UX 问题，互相耦合少，可独立实施验收。

**目标**：
1. 右侧伴随栏只在会话 tab 显示（首页/笔记/数据中心 tab 下不出现）
2. 数据中心从常驻 tab 改为可打开/可关闭的 tab
3. 修复右侧栏「话题/文件/附加」tab 底部内容被裁切
4. 删除首页 tab，报告并入笔记面板（第四个 mode），捕捉盒删除不留入口
5. 全部窗口统一自绘标题栏（Electron 原生 `titleBarStyle: 'hidden'` + overlay），左侧显示各窗口名称

---

## 改动 1：右侧栏仅会话 tab 显示

**现状**：`app/page.tsx` 中 `<CompanionPanel>` 无条件渲染，任何 tab 下都占右侧。

**方案**：
- `stores/session-store.ts`：导出 `isSentinelTabId(id: string): boolean`（复用内部 `SENTINEL_TAB_IDS`）
- `app/page.tsx`：`{!isSentinelTabId(activeTabId) && <CompanionPanel ... />}`
- `ui-store.rightPanelOpen` 开关状态**不重置**：切到哨兵 tab 再切回会话，右侧栏按原状态恢复
- 工作台独立窗口（`full` 模式）不受影响

## 改动 2：数据中心可关闭

**现状**：`DATA_CENTER_TAB_ID` 哨兵 tab 常驻 tab 栏左侧，无法关闭。

**方案**：
- `stores/session-store.ts`：
  - 新增 `dataCenterTabOpen: boolean`，初始值从 `localStorage['data-center-tab-open']` 读取（记住上次状态，缺省 false）
  - `openDataCenterTab()`：置 open + `activeTabId = DATA_CENTER_TAB_ID`，写 localStorage
  - `closeDataCenterTab()`：置 open=false 写 localStorage；若当前 active 是数据中心，回退 `lastActiveConversationTabId ?? NOTES_TAB_ID`
- `components/WorkspaceTabBar.tsx`：数据中心 tab 按 `dataCenterTabOpen` 条件渲染，加 hover 显示的 X 关闭按钮（调 `closeDataCenterTab`），保留现有的「弹出为独立窗口」按钮
- `app/page.tsx` header 按钮：`switchTab(DATA_CENTER_TAB_ID)` 改为 `openDataCenterTab()`
- `app/page.tsx`：DataCenterPage 挂载改为 `dataCenterTabOpen` 条件（打开期间保持 display 切换常驻挂载，关闭即卸载）

## 改动 3：右侧栏三个面板底部裁切修复

**根因**：面板根元素 `h-full`（= 父 aside 的 100% 高），但 aside 内上方还有 tab 栏（约 34px），内容总高恒超 aside，底部被 `overflow-hidden` 裁掉。终端 tab 用 `flex-1 min-h-0` 无此问题。

**修复**（三处同型，`h-full` → `flex-1 min-h-0`）：
- `components/TopicPanel.tsx:169`
- `components/WorkspaceExplorer.tsx:853`
- `components/AdditionalFilesPanel.tsx:84`

## 改动 4：删首页 tab，报告并入笔记

**现状**：首页 = ReportSection（首页报告 md 渲染）+ CaptureBox（快速捕捉 + 最近 5 条笔记）。用户确认捕捉盒无保留价值。

**方案**：
- `stores/session-store.ts`：
  - 删除 `HOME_TAB_ID` 常量；`SENTINEL_TAB_IDS` 剩 `{NOTES_TAB_ID, DATA_CENTER_TAB_ID}`
  - 初始 `activeTabId`、`closeTab` 回退、`reset` 的回退目标 `HOME_TAB_ID` → `NOTES_TAB_ID`
- `components/WorkspaceTabBar.tsx`：删除首页按钮及 import（Home 图标）
- `app/page.tsx`：删除 Dashboard 挂载块与 import
- `components/notes/NotesPanel.tsx`：
  - `PanelMode` 加 `'report'`；`MODES` 加 `{ id: 'report', label: '报告', icon: Newspaper }`
  - `renderContent()` 加 report 分支渲染 `ReportSection`（全宽，不套左右列表布局）
  - report mode 下不渲染搜索框（单页 md 无搜索语义）、无 TagFilter/新建按钮
- `components/dashboard/ReportSection.tsx` → 移至 `components/notes/ReportSection.tsx`；空态文案去掉「聊聊首页」口令，改为引导设置 → 会话摘要生成
- 删除 `components/dashboard/Dashboard.tsx`、`CaptureBox.tsx`；`dashboard-store` 及 `dogear__ReadReport/WriteReport` 链路不动
- `focusTask` 事件（切 NOTES_TAB_ID + 聚焦任务）不受影响

## 改动 5：全窗口统一自绘标题栏 + 名称

**现状**：
- 主窗口、会话窗口：`titleBarStyle: 'hidden'` + overlay（36px），顶部纯 CSS 拖拽空白条，无名称
- 工作台/数据中心/自选股：原生标题栏（有名称，但配色跟系统走，暗色主题下违和）

**技术性质**：全部走 Electron 原生机制——hidden 隐藏标题栏、overlay 让 OS 原生绘制右上三键（配色经 `setTitleBarOverlay` 同步，`syncTitleBarOverlay()` 已存在）、拖拽用原生 CSS `-webkit-app-region: drag`。

**方案**：
- 新组件 `components/TitleBar.tsx`：
  - `fixed top-0 left-0 right-0`，高度 `env(titlebar-area-height, 36px)`，z-index **低于**现有 `#root::before` drag 层（9999）
  - `pointer-events-none`（点击穿透到 drag 层，拖拽/双击最大化行为不变）
  - 左侧名称（truncate），右侧 `pr-32` 避让系统按钮（overlay 按钮由 OS 绘制在最上层，文字不与其重叠）
- `electron/main/index.ts`：`createStockWindow` / `createDataCenterWindow` / `createWorkbenchWindow` 的 BrowserWindow 配置加 `titleBarStyle: 'hidden'` + `titleBarOverlay: currentTitleBarOverlay()`；`title` 属性保留（任务栏/Alt-Tab 显示）
- 各页面接入 `<TitleBar>`：
  - `app/page.tsx`（主窗口）：「Dogear」，同时**删除 header 中现有的 h1「Dogear」**（工作区切换器留 header 原位）
  - `app/session-window/page.tsx`：会话标题（conversation-store 动态派生，随 `updateTitle` 自动更新）
  - `app/workbench-window/page.tsx`：「伴随工作台」
  - `app/data-center/page.tsx`：「数据中心」
  - `app/stocks/page.tsx`：「自选股行情」
- 36px 让位机制复用现有全局 CSS（`#root { padding-top: env(titlebar-area-height) }`），原三个原生窗口改 overlay 后自动获得让位
- 主题切换：`syncTitleBarOverlay()` 广播所有窗口，改 overlay 后自动受益，无需改

---

**模块边界**：
- 渲染层：`app/page.tsx`、`app/session-window/page.tsx`、`app/workbench-window/page.tsx`、`app/data-center/page.tsx`、`app/stocks/page.tsx`
- 组件：`WorkspaceTabBar.tsx`、`NotesPanel.tsx`、`ReportSection.tsx`（移动）、`TopicPanel.tsx`、`WorkspaceExplorer.tsx`、`AdditionalFilesPanel.tsx`、新增 `TitleBar.tsx`；删除 `dashboard/Dashboard.tsx`、`dashboard/CaptureBox.tsx`
- Store：`session-store.ts`（哨兵精简 + dataCenterTabOpen + isSentinelTabId 导出）
- 主进程：`electron/main/index.ts`（三个窗口构造函数加 overlay 配置）

**错误处理 / 边界**：
- `HOME_TAB_ID` 删除后所有引用必须清零（tsc 编译期保证；已 grep 确认引用仅在 page.tsx / WorkspaceTabBar / session-store 三处）
- 数据中心关闭时直接卸载（只读查询页，无副作用）
- 会话窗口 TitleBar 标题在会话标题更新时经 store 派生自动刷新
- 自选股/数据中心页面若有 `fixed top-0` 元素，可能被 36px 让位影响——实施时检查这两页布局
- 首次启动默认 tab 从首页变笔记页，行为可接受

**未决问题**：无（口令文案等小事实施时按上述方案处理）。
