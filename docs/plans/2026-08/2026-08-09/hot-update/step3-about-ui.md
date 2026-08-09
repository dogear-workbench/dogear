---
step: 3
title: 设置页「关于」Tab
status: done
---

## 目标
在设置页新增「关于」Tab，提供检查更新入口、版本信息展示、更新进度反馈。

## 依赖上下文（接力棒输入）
- Step 2 产出：tipc updater 路由已注册，可用方法：
  - `checkForUpdates()` → `{ hasUpdate, type, info } | { hasUpdate: false }`
  - `downloadAndApplyHotfix()` → 下载 + 应用，推送 `updateProgress` 事件
  - `getUpdateConfig()` / `setUpdateConfig({ serverUrl })`
  - `getAppVersion()` → string
- 设置页结构：`app/settings/page.tsx`，纵向 Tabs 布局，新增 Tab 需加 TabsTrigger + TabsContent

## 计划改动

### app/settings/AboutTab.tsx（新建）
- [ ] 展示当前版本号（`getAppVersion()`）
- [ ] 「检查更新」按钮 → 调 `checkForUpdates()`
  - 无更新：显示「已是最新版本」
  - 有热更新：显示版本号 + 更新内容（如有）+ 「下载并应用」按钮
  - 有全量更新：显示版本号 + 「下载安装包」按钮（下载 exe 后运行）
- [ ] 下载进度条：监听 `updateProgress` 事件，显示百分比
- [ ] 热更新完成后：提示「更新完成，正在刷新...」，调 `window.location.reload()` 或等待主进程 reload
- [ ] 更新服务地址输入框（可修改 `serverUrl`），带「测试连接」按钮可选

### app/settings/page.tsx
- [ ] import AboutTab
- [ ] 在 TabsList 末尾加 TabsTrigger（value="about"，标签「关于」）
- [ ] 加对应 TabsContent 渲染 `<AboutTab />`

### stores/settings-store.ts（如需要）
- [ ] 如果 serverUrl 编辑需要 store 支持更新设置子对象，加对应 action

## 实施回填（做完后填）

### 实际改动
（待填）

### 给下一步的接力棒
（待填）
