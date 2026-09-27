---
step: 1
title: 主进程体验适配
status: pending
---

## 目标
mac 上 dev 启动即撞的五处体验问题全部修复，Windows 行为不变。

## 依赖上下文（接力棒输入）
- 审计依据：共享区 `macos-compat/20260926-main-process-audit.md` ⚠️-1/3/4/5、`20260926-build-frontend-audit.md` B5/B6/B7
- 前置 step 产出：无（首步）

## 计划改动
- [ ] **PATH 注入**（影响面最广，先做）：`electron/main/main-app.ts` app ready 后、任何 git/python/bun 探测前，`execFile('/bin/zsh', ['-l', '-c', 'echo $PATH'])` 取登录 shell PATH merge 进 `process.env.PATH`（仅 darwin；去重保序）。注意要在 agent-manager Worker 启动前完成（Worker env 继承主进程）
- [ ] **菜单栏**：`electron/main/main-app.ts:175` `Menu.setApplicationMenu(null)` 改平台分支——win32 保持 null；darwin 用 `Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])`，否则 Cmd+C/V/X/Z 全废
- [ ] **activate 行为**：`electron/main/main-app.ts:253-256` activate 时若 `mainWindow` 存在则 `show()` + `focus()`，否则才重建（修复红叉 hide 后点 Dock 唤不回）
- [ ] **托盘**：`electron/main/tray.ts:14-19` darwin 分支加载 png（`build/icon-tray.png` 16/18@2x 或 template image `icon-tray-template.png` 适配深浅色）；`:23-27` 的 catch 里 darwin 不 `setQuitting(true)`（防「关窗即退出」被误开）。png 资源由 Step 2 补进 extraResources，本步先用 dev 路径 `build/` 兜底 + 缺失时不 crash
- [ ] **标题栏**：`electron/main/window-factories.ts:90-91/128-129/302-303` 三处 + `createWindowWithBounds`——darwin 用 `titleBarStyle: 'hiddenInset'`（不用 titleBarOverlay）；`src/components/TitleBar.tsx` 需 darwin 左侧留 ~80px（红绿灯位置）。前端拿平台：preload 已暴露的能力里若无 `process.platform`，经现有 tipc/环境接口加一个只读字段，不硬编码 UA 嗅探。**方案待真机验证**：若 hiddenInset 下 `env(titlebar-area-height)` 失效导致布局崩，fallback 为保留 titleBarOverlay + 纯前端 padding。本步实现按 hiddenInset 主案
- [ ] 每处改动后 `bun run build:electron` 编译通过；Windows 上跑一次 dev 冒烟（窗口/托盘/菜单正常）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
