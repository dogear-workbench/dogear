# 设置 overlay 回退 + 数据中心 tab 化 实施计划

**目标**：设置从独立窗口回退为主窗口全屏 overlay；数据中心新增主窗口固定 tab（保留独立窗口链路）。

**架构思路**：设置恢复 `e5af0ae` 之前的 ui-store overlay 形态，主进程设置窗口全链路拆除；`broadcastSettingsChanged` → `setup-settings-sync` 联动链路原样保留（同窗口自收自发天然成立）。数据中心用 `DATA_CENTER_TAB_ID` 哨兵做固定 tab，与首页/笔记同构常驻挂载，独立窗口入口移到 tab 的 hover 弹出按钮。

**涉及模块**：`stores/ui-store.ts` / `stores/session-store.ts` / `stores/workspace-store.ts` / `src/App.tsx` / `app/page.tsx` / `app/settings/page.tsx` / `app/data-center/page.tsx` / `components/WorkspaceTabBar.tsx` / `electron/main/index.ts` / `electron/main/tipc/windows.ts` / `electron/main/tipc/renderer-handlers.ts`

**设计文档**：[../settings-overlay-datacenter-tab-design.md](../settings-overlay-datacenter-tab-design.md)

## 步骤索引

- [x] [Step 1: 设置回退 overlay 并拆除设置窗口链路](./step1-settings-overlay.md) — 渲染层恢复 overlay + 主进程删 settingsWindow/三个 IPC/settingsCloseRequested
- [ ] [Step 2: 数据中心固定 tab 化](./step2-datacenter-tab.md) — 哨兵 tab + WorkspaceTabBar 按钮 + 内容挂载 + h-screen 适配
- [ ] [Step 3: 构建验证与 doc-sync](./step3-verify-docsync.md) — lint / build:electron / build + codebase-map 同步

## 全局决策

- 设置保存联动链路（updateSettings → broadcastSettingsChanged → setup-settings-sync）**零改动**，不删任何 settingsChanged 相关代码
- 数据中心独立窗口（createDataCenterWindow + openDataCenterWindow IPC + /data-center 路由）**零拆除**，仅新增 tab 入口
- dirty 三按钮拦截流程（放弃/保存/保存并重启）保留，仅把「关闭」动作从关窗口换成关 overlay
- 固定 tab 哨兵沿用 `__xxx__` 命名（HOME_TAB_ID / NOTES_TAB_ID 同机制）
- 不写注释；不留 TODO
