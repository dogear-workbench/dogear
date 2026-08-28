---
step: 3
title: 构建验证与 doc-sync
status: done
---

## 目标

全量构建验证 + codebase-map 同步，计划收尾。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 设置已回退 overlay、设置窗口链路已拆除；step2 数据中心固定 tab 已挂载、独立窗口保留
- 主进程代码有改动，`bun run build:electron` 必须跑（Vite 热重载只对前端生效）

## 计划改动

- [ ] `bun run lint` 通过
- [ ] `bun run build:electron` 通过（主进程 TypeScript 编译）
- [ ] `bun run build` 通过（含 Vite 前端构建，抓渲染层类型错误）
- [ ] grep 确认无残留：`settingsWindow` / `settingsCloseRequested` / `openSettingsWindow` / `requestCloseSettingsWindow` / `forceCloseSettingsWindow`（dist/ 与 docs/plans/ 除外）
- [ ] doc-sync：更新 `docs/codebase-map.md` 中设置页与数据中心的描述（设置窗口 → overlay；数据中心 → 固定 tab + 可弹独立窗口）
- [ ] `plan.md` 补「完成总结」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无（lint / build:electron / build 全通过；残留 grep 零命中）
- 改动文件清单：`docs/codebase-map.md`（12 处描述同步：App.tsx 路由+overlay、page.tsx header、settings/page.tsx 形态、AbilityTab 措辞、data-center 目录定位、ui-store、session-store 哨兵、smart-category-store 同实例、setup-settings-sync 自收自发、主进程窗口列表、windows.ts 路由、workspace-store actions）

### 给下一步的接力棒
- 待办或已知限制：无
