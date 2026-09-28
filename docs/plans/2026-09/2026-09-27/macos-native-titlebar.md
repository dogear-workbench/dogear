# macOS 标题栏定案：默认原生标题栏（方案 A）

**背景**：macos-compat step6 真机验证发现 `hiddenInset` 下红绿灯压住页面内容——`TitleBar` 是 `fixed + pointer-events-none` 浮层不占布局空间，各窗口页面 header/tabs 从 y=0 渲染被直接遮住；且页面无 `-webkit-app-region: drag`，macOS 上窗口拖不动。用户拍板：darwin 改用默认原生标题栏（红绿灯+标题画在系统原生条里，约 28px，视口从原生条下方开始，页面布局完全不受影响）。step6 清单里预留的 fallback「titleBarOverlay + 前端 padding」不可行（WCO 是 Windows 专属），本文件即定案替代。

**范围**：仅 darwin 分支，Windows 路径零改动。问题 2（独立窗口变原生 tab）不在本任务内，等真机验证系统设置后再定。

## 改动清单

1. `electron/main/window-factories.ts` — `titleBarOptions()`：darwin 分支从 `{ titleBarStyle: 'hiddenInset' }` 改为返回 `{}`（默认标题栏）；同步更新注释。主/会话/工作台/笔记/数据中心/自选股窗口全走此函数，一处覆盖。`syncTitleBarOverlay()` 不动（darwin 下无 overlay，catch 忽略，现状即如此）。
2. `components/TitleBar.tsx` — `isMac === true` 时 `return null`：原生标题栏已显示窗口 title（各窗口构造时都传了 title），浮层标题不再渲染。组件签名不变，各页面引用零改动。
3. `src/App.tsx` — 设置页全屏 overlay 的 `paddingTop: 'env(titlebar-area-height, 36px)'`：darwin 下原生标题栏不占 Chromium 视口，需改为 0（照 `BehaviorTab` 模式加 `client.getPlatform()` state 判断；Windows 保持 env 不动）。
4. `docs/plans/2026-09/2026-09-26/macos-compat/step6-on-device-verification.md` — 回填「标题栏定案」项结论：定案方案 A，红绿灯遮挡与窗口拖不动随之修复。

## 验证

- Windows 回归：`bun run build:electron` 编译过 + 主窗口/子窗口顶部表现不变（WCO 条、TitleBar 照常）。
- macOS 真机（用户配合）：红绿灯不压内容、原生条可拖动窗口、设置页顶部无多余空白。

## 分步骤判断

不分步骤：3 个代码文件改动点彼此独立、无执行顺序依赖、非架构变更，单次实施即可完成。
