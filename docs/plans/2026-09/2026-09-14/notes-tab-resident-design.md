# 笔记 tab 常驻 + 窗口位置/最大化记忆（含主窗口） 设计

**日期**：2026-09-14
**状态**：已拍板（用户确认形态：保持现状布局，笔记 tab 常驻不可关闭，默认落在笔记；主窗口也加位置/尺寸/最大化记忆，后续打开大小以用户当前排布为准）

## 背景

双屏多窗口改版（dual-window-layout）后笔记 tab 变为可开关，用户明确要回退为「常驻」：保持哨兵 tab 右置、启动默认打开并落在笔记，但笔记 tab 不可关闭。另反馈笔记独立窗口「关闭再打开没有原样恢复、没记住位置」——排查结论：位置/尺寸记忆已存在（window-state-service + createWindowWithBounds，window-state.json 有 notes-window 记录），缺口是**最大化状态不持久化**：窗口最大化时 `persistBounds` 直接跳过保存，关窗后重开会退回最大化之前的默认位置与尺寸，正是用户观察到的现象（两份 window-state.json 中 notes-window 均停在近默认值，佐证用户是最大化后关闭）。

## 目标

1. 笔记 tab 常驻：不可关闭、无关闭按钮；启动默认 activeTabId = 笔记；弹出独立窗口期间 tab 照旧隐藏、关窗恢复
2. 关掉所有会话 tab 后兜底回笔记 tab（恢复原先行为；笔记窗口弹出中则回空态）
3. 窗口位置记忆补全：普通 bounds 之外持久化「是否最大化」，重开时先按普通 bounds 定位再 maximize，原样恢复（笔记/工作台/数据中心三窗口共用）
4. 主窗口（Dogear 主窗）同样记忆位置/尺寸/最大化，key `main-window`；上线后用户首次排布即被记住，此后默认打开大小 = 用户当前排布

## 改动清单

### A. 窗口最大化记忆（主进程）

- `electron/main/services/window-state-service.ts`：`WindowBounds` 加可选 `maximized?: boolean`；`isValidBounds` 校验（存在时必须为 boolean）
- `electron/main/main-app.ts` `createWindowWithBounds`：
  - `persistBounds`：最大化时改存 `getNormalBounds()` + `maximized: true`（moved/resized 防抖路径与 close 补写路径共用）；普通态存 `maximized: false`
  - 恢复：创建后若 `saved.maximized` 则 `win.maximize()`（普通 bounds 已把窗口定位到对应显示器，maximize 落在正确屏上）；现有 60px 可视区校验保持在前
  - `hashPath` 允许为空：主窗口加载不带 `#`（`hashPath ? base#x : base`）
- `electron/main/main-app.ts` `createWindow` 重构：改 async，内部 `await createWindowWithBounds({ stateKey: 'main-window', 1200x800, hashPath: '' })`；托盘隐藏逻辑（`close` → preventDefault + hide）与通知注册移入 createWindow 内（原来在 whenReady 里用 `mainWindow!` 挂监听，异步化后时序不保证，必须内聚）；whenReady 处改 `void createWindow()` 后接 createTray 不受影响
  - 主窗口关闭走「隐藏到托盘」：`close` 事件仍先于 preventDefault 触发，位置补写正常执行；托盘真退出（isQuitting）路径同样经 close 补写
  - activate 重建路径（全部窗口关闭后再激活）复用 createWindow，自动带记忆

### B. 笔记 tab 常驻（前端）

- `stores/session-store.ts`：
  - 删 `notesTabOpen` / `NOTES_TAB_OPEN_KEY` / `readNotesTabOpen` / `openNotesTab` / `closeNotesTab`（localStorage 旧键残留无害，不清理）
  - 新增 `pickFallbackTab`：`pickFallbackConversationTab ?? (notesWindowOpen ? null : NOTES_TAB_ID)`；`closeTab`（关的是当前激活 tab 且无剩余会话 tab 时）/ `closeDataCenterTab` / `fallbackActiveTab` 改用它
  - `switchTab` 删「笔记 tab 未开时视为重开」分支；保留「笔记窗口弹出中落回可用 tab」分支
  - 初始与 `reset` 的 `activeTabId` 恒为 `NOTES_TAB_ID`
- `components/WorkspaceTabBar.tsx`：笔记 tab 删关闭按钮（保留弹出按钮）；`notesTabOpen` 引用移除（渲染条件简化为 `!notesWindowOpen`）
- `app/page.tsx`：NotesPanel 挂载条件 `notesTabOpen && !notesWindowOpen` → `!notesWindowOpen`；删 `notesTabOpen` selector
- 其余 7+ 处 `switchTab(NOTES_TAB_ID)` 跳转入口（通知中心/ToolBlock/NoteCardRenderer/TaskReportMessage/AgentChat/focusTask）不动，常驻后天然有效

## 边界情况

- 笔记窗口弹出中关掉最后一个会话 tab：笔记 tab 隐藏中，落空态 EmptyFocusState（唯一空态入口）
- 笔记弹出中 `switchTab(NOTES_TAB_ID)`（通知点击但窗口被主进程路由外的路径触发）：保持现状落回最近可用 tab
- 最大化状态 + 显示器拔除后重开：普通 bounds 先过 60px 可视区校验（不过则 center），再 maximize，不会丢窗口
- `closeNotesTab` 删除后无外部调用残留（已 grep 确认仅 WorkspaceTabBar 在用）
- 主窗口记忆首次生效时机：新版本首启无存档仍 1200x800，用户排布一次（移动/缩放/最大化，moved/resized 防抖或关窗/隐藏到托盘即落盘）后即为后续默认
- 独立会话窗口、自选股窗口不在本次范围（瞬时窗口/未提需求，后续要加照 createWindowWithBounds 一行接入）

## 不分步骤说明

两个改动（A 主进程窗口记忆 / B 前端常驻）相互独立、各为小改动，总 5 文件无依赖链，单会话一次实施完成，不拆 step。
