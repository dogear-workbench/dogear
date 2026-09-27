---
step: 1
title: 主进程体验适配
status: done
---

## 目标
mac 上 dev 启动即撞的五处体验问题全部修复，Windows 行为不变。

## 依赖上下文（接力棒输入）
- 审计依据：共享区 `macos-compat/20260926-main-process-audit.md` ⚠️-1/3/4/5、`20260926-build-frontend-audit.md` B5/B6/B7
- 前置 step 产出：无（首步）

## 计划改动
- [x] **PATH 注入**（影响面最广，先做）：`electron/main/main-app.ts` app ready 后、任何 git/python/bun 探测前，`execFile('/bin/zsh', ['-l', '-c', 'echo $PATH'])` 取登录 shell PATH merge 进 `process.env.PATH`（仅 darwin；去重保序）。注意要在 agent-manager Worker 启动前完成（Worker env 继承主进程）
- [x] **菜单栏**：`electron/main/main-app.ts:175` `Menu.setApplicationMenu(null)` 改平台分支——win32 保持 null；darwin 用 `Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])`，否则 Cmd+C/V/X/Z 全废
- [x] **activate 行为**：`electron/main/main-app.ts:253-256` activate 时若 `mainWindow` 存在则 `show()` + `focus()`，否则才重建（修复红叉 hide 后点 Dock 唤不回）
- [x] **托盘**：`electron/main/tray.ts:14-19` darwin 分支加载 png（`build/icon-tray.png` 16/18@2x 或 template image `icon-tray-template.png` 适配深浅色）；`:23-27` 的 catch 里 darwin 不 `setQuitting(true)`（防「关窗即退出」被误开）。png 资源由 Step 2 补进 extraResources，本步先用 dev 路径 `build/` 兜底 + 缺失时不 crash
- [x] **标题栏**：`electron/main/window-factories.ts:90-91/128-129/302-303` 三处 + `createWindowWithBounds`——darwin 用 `titleBarStyle: 'hiddenInset'`（不用 titleBarOverlay）；`src/components/TitleBar.tsx` 需 darwin 左侧留 ~80px（红绿灯位置）。前端拿平台：preload 已暴露的能力里若无 `process.platform`，经现有 tipc/环境接口加一个只读字段，不硬编码 UA 嗅探。**方案待真机验证**：若 hiddenInset 下 `env(titlebar-area-height)` 失效导致布局崩，fallback 为保留 titleBarOverlay + 纯前端 padding。本步实现按 hiddenInset 主案
- [x] 每处改动后 `bun run build:electron` 编译通过；Windows 上跑一次 dev 冒烟（窗口/托盘/菜单正常）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - PATH merge 顺序采用「shell 独有条目前置」而非简单 append：GUI 冷启动时 Homebrew 工具需优先于 /usr/bin 旧版（Xcode CLT）；终端 dev 启动时原 PATH 已是登录 PATH 超集，结果不变
  - darwin 托盘 template 标记用 `nativeImage.setTemplateImage(true)` API 而非依赖文件名 `icon-tray-template.png`：Electron 对文件名判定区分大小写且要求 `Template` 后缀，API 方式不依赖资源命名
  - 平台探测落在 `environmentRouter.getPlatform` procedure（返回 `process.platform` 字符串），前端 `client.getPlatform()` 异步取；TitleBar 默认非 mac 布局，取到 darwin 后切 `pl-20`（80px 红绿灯让位）
- 改动文件清单：
  - `electron/main/main-app.ts`：`injectLoginShellPath()`（darwin zsh -l 取 PATH 前置合并去重保序，whenReady 首行 await，先于 agent-manager Worker 启动）；菜单 darwin 三 role 模板 / 其他平台 null；activate 有存活主窗口则 restore+show+focus 否则才重建
  - `electron/main/tray.ts`：darwin 加载 `icon-tray.png`（dev `build/`、prod resourcesPath）+ setTemplateImage；创建失败时 darwin 不 setQuitting(true)；Windows ico 路径与行为原样
  - `electron/main/window-factories.ts`：新增 `titleBarOptions()`（darwin `hiddenInset` 无 overlay，其余原 hidden+overlay），三处窗口创建点接入
  - `electron/main/tipc/environment.ts`：新增 `getPlatform` 只读 procedure
  - `components/TitleBar.tsx`：darwin 左侧 80px 让位（isMac 态经 getPlatform 异步获取）
- 验证：`bun run build:electron` ✓、`bun run lint` ✓（0 error，改动文件无新告警）、`bun run build` 全量 ✓、Windows dev 冒烟启动正常（AgentManager 初始化完成、托盘/窗口无报错）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `injectLoginShellPath(): Promise<void>`（main-app.ts，win32 直接 return）
  - `titleBarOptions()`：darwin 返回 `{ titleBarStyle: 'hiddenInset' }`，其余 `{ titleBarStyle: 'hidden', titleBarOverlay: {...} }`
  - `environmentRouter.getPlatform: () => Promise<NodeJS.Platform>`
- 下个 step 该从哪里继续：Step 2 需补 `icon-tray.png`（建议纯黑+alpha 单色图，16/32@2x）进 extraResources（darwin 段），dev 放 `build/icon-tray.png` 即生效；mac 打包段（icns/category/identity）同属 Step 2
- 待办或已知限制：
  - hiddenInset 主案需 mac 真机验证：`env(titlebar-area-height)` 在 hiddenInset 下取 fallback（globals.css `#root` 为 0px、App.tsx 设置页为 36px），若布局异常按计划 fallback 到 titleBarOverlay + 前端 padding
  - mac 上主窗口点红叉仍 hide 到托盘（未改为真关闭），Dock activate 已可唤回；若真机反馈违和可后续改「mac 点红叉真关闭」
  - 托盘 png 资源就位前，mac dev 托盘会走 catch 分支（无图标、关窗不退出）
