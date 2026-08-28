---
step: 2
title: 数据中心固定 tab 化
status: pending
---

## 目标

主窗口新增「数据中心」固定 tab（笔记右侧），header 按钮改为切 tab，tab 上 hover 提供弹出独立窗口入口；独立窗口链路不动。

## 依赖上下文（接力棒输入）

- 设计文档：[../settings-overlay-datacenter-tab-design.md](../settings-overlay-datacenter-tab-design.md) 第二节
- 现状关键位置：
  - `stores/session-store.ts:9-11` — HOME_TAB_ID / NOTES_TAB_ID 哨兵定义（同机制加新哨兵）
  - `components/WorkspaceTabBar.tsx:77-95` — 笔记固定 tab 按钮（数据中心按钮加在其后）；会话 tab 的 hover 弹出按钮样式参考第 160-167 行
  - `app/page.tsx:285-292` — 笔记挂载块（absolute inset-0 + display 切换，数据中心同构）
  - `app/page.tsx:76-77` — `openDataCenterWindow` 引用处（header 按钮，改 switchTab）
  - `app/data-center/page.tsx:23` — 根容器 `h-screen`
- 关键决策回顾：常驻挂载（与首页/笔记同构 display 切换，不卸载）；`workspace-store.openDataCenterWindow` 删除（header 不再用，WorkspaceTabBar 直接 `client.openDataCenterWindow()`）；`openStockWindow` 保留

## 计划改动

- [ ] `stores/session-store.ts` — `export const DATA_CENTER_TAB_ID = '__data_center__';`（NOTES_TAB_ID 后）
- [ ] `components/WorkspaceTabBar.tsx` — 笔记按钮后加「数据中心」固定 tab：Database 图标 + 文案，`group` 类 + hover 显示 ExternalLink 小按钮（样式对齐会话 tab 的弹出按钮），点击调 `client.openDataCenterWindow()`；import DATA_CENTER_TAB_ID、Database、ExternalLink（ExternalLink 已有则不重复）
- [ ] `app/page.tsx` — import DataCenterPage 与 DATA_CENTER_TAB_ID；内容区笔记块后加同构挂载块；header「数据中心」按钮 onClick 改 `switchTab(DATA_CENTER_TAB_ID)`（switchTab 从 session-store 取）；删 `openDataCenterWindow` 引用
- [ ] `stores/workspace-store.ts` — 删 `openDataCenterWindow` 接口声明与实现
- [ ] `app/data-center/page.tsx` — 根容器 `h-screen` → `h-full`
- [ ] `src/App.tsx` — `/data-center` 路由 element 外包 `<div className="h-screen">` 壳（独立窗口整页高度不变）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
