# 设置 overlay 回退 + 数据中心 tab 化 实施计划

**目标**：设置从独立窗口回退为主窗口全屏 overlay；数据中心新增主窗口固定 tab（保留独立窗口链路）。

**架构思路**：设置恢复 `e5af0ae` 之前的 ui-store overlay 形态，主进程设置窗口全链路拆除；`broadcastSettingsChanged` → `setup-settings-sync` 联动链路原样保留（同窗口自收自发天然成立）。数据中心用 `DATA_CENTER_TAB_ID` 哨兵做固定 tab，与首页/笔记同构常驻挂载，独立窗口入口移到 tab 的 hover 弹出按钮。

**涉及模块**：`stores/ui-store.ts` / `stores/session-store.ts` / `stores/workspace-store.ts` / `src/App.tsx` / `app/page.tsx` / `app/settings/page.tsx` / `app/data-center/page.tsx` / `components/WorkspaceTabBar.tsx` / `electron/main/index.ts` / `electron/main/tipc/windows.ts` / `electron/main/tipc/renderer-handlers.ts`

**设计文档**：[../settings-overlay-datacenter-tab-design.md](../settings-overlay-datacenter-tab-design.md)

## 步骤索引

- [x] [Step 1: 设置回退 overlay 并拆除设置窗口链路](./step1-settings-overlay.md) — 渲染层恢复 overlay + 主进程删 settingsWindow/三个 IPC/settingsCloseRequested
- [x] [Step 2: 数据中心固定 tab 化](./step2-datacenter-tab.md) — 哨兵 tab + WorkspaceTabBar 按钮 + 内容挂载 + h-screen 适配
- [x] [Step 3: 构建验证与 doc-sync](./step3-verify-docsync.md) — lint / build:electron / build + codebase-map 同步

## 全局决策

- 设置保存联动链路（updateSettings → broadcastSettingsChanged → setup-settings-sync）**零改动**，不删任何 settingsChanged 相关代码
- 数据中心独立窗口（createDataCenterWindow + openDataCenterWindow IPC + /data-center 路由）**零拆除**，仅新增 tab 入口
- dirty 三按钮拦截流程（放弃/保存/保存并重启）保留，仅把「关闭」动作从关窗口换成关 overlay
- 固定 tab 哨兵沿用 `__xxx__` 命名（HOME_TAB_ID / NOTES_TAB_ID 同机制）
- 不写注释；不留 TODO

## 完成总结

全部三步完成（commits：`0b2c508` step1 / `066ffc2` step2 / step3 本次）。

**实际改动汇总**：
- 设置：回退主窗口全屏 overlay（ui-store settingsOpen + App.tsx fixed inset-0），dirty 三按钮拦截保留、关闭动作改关 overlay；主进程 settingsWindow/close guard/三个窗口 IPC/settingsCloseRequested 全拆除（+36/−127，净删 91 行）；保存联动链路 broadcastSettingsChanged → setup-settings-sync 零改动（同窗口自收自发）
- 数据中心：新增主窗口固定 tab（DATA_CENTER_TAB_ID 哨兵，笔记右侧，常驻挂载 display 切换）；header 按钮改切 tab；tab hover 弹出独立窗口（client.openDataCenterWindow 链路保留）；根容器 h-screen → h-full + /data-center 路由外包 h-screen 壳

**与原计划的偏差**：
- step1 计划外多改 `components/dashboard/ReportSection.tsx`（它引用 openSettingsWindow，不改编译失败）；forceCloseSettingsWindow 实际 5 处（计划写 4 处）
- step2 固定 tab 外层用 div 而非 button（button 不能嵌 button，与会话 tab 同构）
- 已接受代价（设计文档已记录）：tab 常驻挂载带后台分钟级轮询；tab 与独立窗口双实例并发编辑定时任务后保存者覆盖（边缘情况）
