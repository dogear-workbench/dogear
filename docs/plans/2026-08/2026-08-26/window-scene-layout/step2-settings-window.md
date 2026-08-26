---
step: 2
title: 设置窗口化
status: done
---

## 目标
设置从主窗口 overlay 迁移为独立窗口（单例）；保存后经 `settingsChanged` 广播驱动主窗口刷新与会话重启；窗口关闭（X / 返回按钮）时 dirty 拦截。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1] 已删 Agent 监控；MarkdownFileDialog 已非模态。本 step 不依赖 step1 的具体签名，仅要求工作区可编译
- 当前关键文件状态：
  - `src/App.tsx` — overlay 挂载：`{settingsOpen && <div className="fixed inset-0 z-50 bg-background"><SettingsPage /></div>}`，位于 Router 外；`/settings` 路由**不存在**（需新增）
  - `stores/ui-store.ts` — `settingsOpen / openSettings / closeSettings` 三成员（reset 里也有引用）
  - `stores/settings-store.ts` — `saveSettings`（client.updateSettings + 本地 set）、`restartActiveSessions`（client 调用）、无任何事件订阅
  - `app/settings/page.tsx` — `handleSaveAndRestart` = saveToStore → restartActiveSessions → conversation-store 的 `triggerSessionRestart()` → closeSettings；`handleClose` 内联 dirty confirm（放弃/保存/保存并重启三按钮）；返回按钮调 closeSettings
  - `electron/main/index.ts` — 窗口创建模板见 createStockWindow（~221 行起）：模块级变量 + focus 已存在 + `loadURL(isDev ? \`${getRendererPath()}/#/xxx\` : \`file://${getRendererPath()}#/xxx\`)` + closed 置 null
  - `electron/main/tipc/renderer-handlers.ts` — RendererHandlers 类型集中定义；发送侧惯例 `createRendererHandlers(...).xxx.send(event.sender, data)` 为**定向发送**
  - `lib/events.ts` / `src/main.tsx` — 渲染层事件监听入口与 setup 惯例（`setupManualTaskToasts` 在 main.tsx 顶层挂载）
- 关键决策回顾：tipc 事件定向发给 sender，而 settingsChanged 的目标是**主窗口**（发起保存的是设置窗口），所以主进程发送侧不能复用 action 里的 event.sender，需按窗口筛选

## 计划改动

### 主进程
- [ ] `electron/main/index.ts` — 新增 `settingsWindow` 变量 + `createSettingsWindow()`（1000×760，title「设置」，照抄自选股模板）+ `requestCloseSettingsWindow()`（调 `settingsWindow.close()`，触发 close guard）+ `forceCloseSettingsWindow()`（置 skipGuard 后 close）；close guard 状态机：
  ```
  win.on('close', (e) => {
    if (!closeGuard) return;          // forceClose 直通
    e.preventDefault();
    win.webContents.send('settings:close-requested');   // 询问渲染进程
  })
  ```
- [ ] `electron/main/tipc/windows.ts`（新建）— `openSettingsWindow / requestCloseSettingsWindow / forceCloseSettingsWindow` 三个 procedure，注册进 `index.ts` 路由聚合
- [ ] `electron/main/tipc/settings 相关路由的 updateSettings 实现处` — 落盘成功后广播：遍历 `BrowserWindow.getAllWindows()`，对 url 含 `#/`（排除设置窗口自身）或按主窗口引用，调 rendererHandlers 的 `settingsChanged.send(webContents, { restartSessions })`；payload 的 restartSessions 由 updateSettings 入参透传（新增可选参数）或前端保存时附带意图字段

### 渲染层
- [ ] `electron/main/tipc/renderer-handlers.ts` — 加 `settingsChanged: (data: { restartSessions: boolean }) => void` 与 `settingsCloseRequested: () => void`（后者主进程用裸 webContents.send，也要在类型里登记以便 events.ts 订阅——如 tipc 不支持裸通道则统一走 rendererHandlers 机制，实施时以现有 categoriesUpdated 的发送路径为准对齐）
- [ ] `src/App.tsx` — 删 overlay 块；加 `/settings` 路由渲染 SettingsPage
- [ ] `stores/ui-store.ts` — 删 settingsOpen / openSettings / closeSettings（含 reset 引用）；全局搜残留引用清零
- [ ] `stores/workspace-store.ts` — 加 `openSettingsWindow`（调 client.openSettingsWindow，照抄 openStockWindow 形态）
- [ ] `app/page.tsx` — header 设置按钮改调 openSettingsWindow
- [ ] `app/settings/page.tsx` — 改造关闭与保存链路：
  - 返回按钮 → `client.requestCloseSettingsWindow()`（复用 close-requested 流程）
  - 新增监听 settingsCloseRequested：不 dirty → forceClose；dirty → 复用现有三按钮 confirm（放弃 → forceClose；保存 → saveToStore + forceClose；保存并重启 → saveToStore({restartSessions:true}) + forceClose）
  - `handleSaveAndRestart` 移除本地 restartActiveSessions / triggerSessionRestart / closeSettings 调用（改由主窗口 settingsChanged 监听承担）
- [ ] 主窗口侧新增 `lib/setup-settings-sync.ts`（照 setupManualTaskToasts 惯例，`src/main.tsx` 挂载）— 监听 settingsChanged：`loadSettings()`；若 restartSessions → `restartActiveSessions()` + `useConversationStore.getState().triggerSessionRestart()`

## 验收
- header「设置」打开独立窗口；重复点击不重复开（focus 已有窗口）
- 改设置不保存直接点 X → 弹「未保存的更改」；放弃/保存/保存并重启三路行为正确
- 「保存并重启会话」：设置窗口自动关闭，主窗口设置刷新、活跃会话重挂载（观察会话闪断重建）
- 主窗口内不再出现全屏设置 overlay；`#/settings` 直开可用
- 设置窗口打开状态下主窗口正常可用（不被模态阻塞）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - settingsCloseRequested 未走裸 `webContents.send('settings:close-requested')`，统一走 rendererHandlers 机制（对齐 categoriesUpdated 发送路径，计划已预授权此选择）
  - 广播目标不用 url 筛选，改为 index.ts 导出 `broadcastSettingsChanged()`，按 mainWindow 引用定向发送（两个备选方案中取更精确者，避免会话窗口重复执行 restartActiveSessions）
  - `closeAllChildWindows()` 追加 settingsWindow 强关（照抄 stockWindow 生命周期管理；forceClose 跳过 dirty 拦截，与原 overlay 模式下主窗口关闭即丢 dirty 的行为等价）
  - 计划未列出的 `components/dashboard/ReportSection.tsx` 也引用 openSettings，属「全局残留清零」范围，一并改为 openSettingsWindow
  - settings/page.tsx 的 settingsCloseRequested 监听用 ref 持最新 handleClose（避免每次渲染重订阅）
- 改动文件清单：
  - `electron/main/index.ts` — settingsWindow 单例 + settingsSkipCloseGuard + createSettingsWindow（1000×760，title「设置」，照抄自选股模板）/ requestCloseSettingsWindow / forceCloseSettingsWindow / broadcastSettingsChanged；closeAllChildWindows 追加强关
  - `electron/main/tipc/windows.ts`（新建）— openSettingsWindow / requestCloseSettingsWindow / forceCloseSettingsWindow 三 procedure
  - `electron/main/tipc/index.ts` — 注册 windowsRouter
  - `electron/main/tipc/settings.ts` — updateSettings 加可选 restartSessions 入参，落盘后调 broadcastSettingsChanged
  - `electron/main/tipc/renderer-handlers.ts` — 加 settingsChanged / settingsCloseRequested 事件类型
  - `src/App.tsx` — 删 overlay 块与 useUIStore 引用；加 /settings 路由（* 兜底前）
  - `stores/ui-store.ts` — 删 settingsOpen / openSettings / closeSettings（含 reset 引用）
  - `stores/workspace-store.ts` — 加 openSettingsWindow（照抄 openStockWindow）
  - `app/page.tsx` — header 设置按钮改调 openSettingsWindow
  - `components/dashboard/ReportSection.tsx` — openSettings → openSettingsWindow（残留清零）
  - `stores/settings-store.ts` — saveSettings 加 options?.restartSessions，透传 client.updateSettings
  - `app/settings/page.tsx` — 返回按钮改 client.requestCloseSettingsWindow()；新增 settingsCloseRequested 监听（ref 模式）；handleClose 三路 confirm 后均 forceClose；handleSaveAndRestart 改 saveToStore({restartSessions:true}) + forceClose，删本地 restartActiveSessions / triggerSessionRestart / closeSettings
  - `lib/setup-settings-sync.ts`（新建）— 监听 settingsChanged：loadSettings；restartSessions 时 restartActiveSessions + triggerSessionRestart（照 setupManualTaskToasts 动态 import 惯例）
  - `src/main.tsx` — 顶层挂载 setupSettingsSync()

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - windows.ts 三 procedure：`openSettingsWindow()` / `requestCloseSettingsWindow()` / `forceCloseSettingsWindow()`，均无入参返回 `{success:true}`
  - 事件：`settingsChanged: {restartSessions: boolean}`（仅发主窗口）；`settingsCloseRequested: void`（仅发设置窗口）
  - index.ts 导出：`createSettingsWindow` / `requestCloseSettingsWindow` / `forceCloseSettingsWindow` / `broadcastSettingsChanged(restartSessions: boolean)`
  - settings-store：`saveSettings(settings, options?: {restartSessions?: boolean})`
- 下个 step 该从哪里继续：step3（数据中心）照 step3-datacenter-core.md 开工；新窗口照抄 index.ts 里 settingsWindow 模板（模块级单例 + focus + HashRouter URL + closed 置 null）；若数据中心窗口也要 close guard 可复用 skipGuard 模式
- 待办或已知限制：
  - 主窗口手输 #/settings 会渲染 SettingsPage，返回按钮调 requestCloseSettingsWindow 但无窗口实例，no-op（需 GUI 验证，边缘场景）
  - updateSettings 后端落盘失败返回 {error} 时 settings-store 未 toast（沿袭原行为，非本次引入）
  - GUI 手动验收（三按钮流程、会话重挂载观察）未在子会话环境执行，需人工确认
