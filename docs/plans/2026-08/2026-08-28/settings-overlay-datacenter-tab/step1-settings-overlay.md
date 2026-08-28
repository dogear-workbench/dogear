---
step: 1
title: 设置回退 overlay 并拆除设置窗口链路
status: done
---

## 目标

设置恢复为主窗口全屏 overlay（`e5af0ae` 之前的形态），主进程设置窗口相关代码全部拆除。

## 依赖上下文（接力棒输入）

- 设计文档：[../settings-overlay-datacenter-tab-design.md](../settings-overlay-datacenter-tab-design.md) 第一节
- 原 overlay 形态参考：`git show e5af0ae~1:src/App.tsx`（ui-store.settingsOpen + fixed inset-0 z-50 overlay）与 `git show e5af0ae~1:stores/ui-store.ts`
- 现状关键位置：
  - `electron/main/index.ts:65,71` — settingsWindow / settingsSkipCloseGuard 变量
  - `electron/main/index.ts:198-237` — createSettingsWindow（含 close guard）
  - `electron/main/index.ts:268-283` 附近 — requestCloseSettingsWindow / forceCloseSettingsWindow（以实际 grep 为准）
  - `electron/main/index.ts:288-296` 附近 — broadcastSettingsChanged（**保留不动**）
  - `electron/main/tipc/windows.ts:8-30` — 三个 settings IPC
  - `electron/main/tipc/renderer-handlers.ts:282` — settingsCloseRequested（删）；settingsChanged（**保留**）
  - `app/settings/page.tsx:144-160` — handleClose / settingsCloseRequested 监听
- 关键决策回顾：保存联动链路（broadcastSettingsChanged → setup-settings-sync）完全不动；设置页 h-screen 根容器在 overlay 下仍然正确

## 计划改动

- [ ] `stores/ui-store.ts` — 恢复 `settingsOpen: boolean` / `openSettings()` / `closeSettings()`，reset 里加 `settingsOpen: false`
- [ ] `src/App.tsx` — import useUIStore + SettingsPage；恢复 overlay：`{settingsOpen && (<div className="fixed inset-0 z-50 bg-background"><ErrorBoundary fallback="page"><SettingsPage /></ErrorBoundary></div>)}`；删除 `/settings` 路由
- [ ] `app/page.tsx` — `openSettingsWindow`（workspace-store）换成 `openSettings`（ui-store），header 设置按钮 onClick 更新
- [ ] `app/settings/page.tsx` — 返回按钮 `client.requestCloseSettingsWindow()` → `void handleCloseRef.current()`（或等价的直接调 handleClose，保持 dirty 拦截）；`handleClose`/`handleSaveAndRestart` 里 4 处 `client.forceCloseSettingsWindow()` → `closeSettings()`（ui-store）；删 settingsCloseRequested 监听 useEffect；清理不再用的 import（rendererEvents、client 视实际使用情况）
- [ ] `stores/workspace-store.ts` — 删 `openSettingsWindow` 接口声明与实现（`client.openSettingsWindow` 调用点一并删）
- [ ] `electron/main/index.ts` — 删 settingsWindow / settingsSkipCloseGuard / createSettingsWindow / requestCloseSettingsWindow / forceCloseSettingsWindow；broadcastSettingsChanged 保留
- [ ] `electron/main/tipc/windows.ts` — 删 openSettingsWindow / requestCloseSettingsWindow / forceCloseSettingsWindow 三个 procedure；openDataCenterWindow 保留
- [ ] `electron/main/tipc/renderer-handlers.ts` — 删 `settingsCloseRequested: () => void`；settingsChanged 保留
- [ ] 检查 `types/` 下 electron-api 类型定义若有 settings 窗口 IPC 类型残留一并删

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 计划外新增 `components/dashboard/ReportSection.tsx`：它也引用了 `workspace-store.openSettingsWindow`（上一轮窗口化 step2 的残留清零点），删 workspace-store action 后会编译失败，一并改为 `ui-store.openSettings`
  - `app/settings/page.tsx` 实际 `forceCloseSettingsWindow` 为 5 处（计划写 4 处）：handleSaveAndRestart 1 + handleClose 4（无 dirty 直关 / discard / save / saveRestart）；全部改为 `closeSettings()`；`client` 与 `rendererEvents` import 均删（无其他使用）；`handleCloseRef` 保留（返回按钮直接调它）
  - `broadcastSettingsChanged` 的 error log 前缀 `[settingsWindow]` 改为 `[settings]`（纯日志文案，链路零改动）
  - `renderer-handlers.ts` 里 `settingsChanged` 注释同步去掉「设置窗口」措辞（事件类型与发送/监听链路零改动）
- 改动文件清单：`stores/ui-store.ts`、`src/App.tsx`、`app/page.tsx`、`components/dashboard/ReportSection.tsx`、`app/settings/page.tsx`、`stores/workspace-store.ts`、`electron/main/index.ts`、`electron/main/tipc/windows.ts`、`electron/main/tipc/renderer-handlers.ts`
- 验证：`build:electron` 通过；渲染层 tsc 错误数与基线一致（20 个存量，改动文件零错误）；改动文件 eslint 零错误；Vite 前端构建成功；grep 无 settings 窗口残留（dist/、docs/ 除外）

### 给下一步的接力棒
- 关键签名 / 数据结构：`useUIStore` 新增 `settingsOpen: boolean` / `openSettings()` / `closeSettings()`，`reset()` 会把它归 false（注意：step2 若在数据中心 tab 激活时触发 `clearWorkspace` 会同时关设置 overlay，语义无冲突）；overlay 结构在 `src/App.tsx`：`{settingsOpen && <div className="fixed inset-0 z-50 bg-background">…}`
- 下个 step 该从哪里继续：step2 数据中心 tab 化——`session-store.ts` 加 `DATA_CENTER_TAB_ID` 哨兵；`WorkspaceTabBar.tsx` 加固定 tab（Database 图标 + ExternalLink 弹出按钮调 `client.openDataCenterWindow()`，该 IPC 与 `createDataCenterWindow` 均保留在 `windows.ts` / `index.ts`）；`app/page.tsx` 内容区加 display 切换的常驻挂载块 + header「数据中心」按钮改 `switchTab(DATA_CENTER_TAB_ID)`；`app/data-center/page.tsx` 根容器 `h-screen`→`h-full`；`src/App.tsx` 给 `/data-center` 路由包 `<div className="h-screen">` 壳（该路由仍在 Routes 里，别动）
- 待办或已知限制：设置页根容器保持 `h-screen`（在 overlay 下仍然正确，与设计文档一致）；主窗口手输 `#/settings` 现在会落到 `*` 通配重定向回首页（无残留路由）
