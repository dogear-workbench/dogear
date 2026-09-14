# 双屏工作模式：多窗口排布体系 设计

**日期**：2026-09-14
**状态**：设计已拍板，待写实施计划

## 背景

用户希望主窗口聚焦会话、工具类内容放第二屏（双屏工作模式）。讨论中从「一键双屏切换 + 统一工具箱窗口」演化为最终方案：**各部分独立弹窗 + 用户自己用 OS 窗口排布组合**，不做开关、不做统一容器。

**数据传输结论**（已验证无架构风险）：数据同步层单/多窗口零差距——真相源 = 主进程服务 + 盘上 JSON，`broadcastToWindows` 遍历全窗口无差别广播，各窗口 store 镜像订阅重拉。笔记/数据中心窗口的数据同步复用既有事件（notesChanged / tasksChanged / usageEntryAdded 等），零新增。唯一需要新增的是 UI 意图跨窗口信号（互斥、弹出恢复、通知定位），全部照既有范例（focused-conversation-service / sessionWindowClosed）。

## 目标

- 主窗口可做到「只剩会话」：右侧栏整体弹出（工作台窗口，互斥）、笔记/数据中心 tab 弹出为独立窗口
- 独立窗口记住位置尺寸，关闭后 tab 原样恢复（位置、tab 开关状态不被重置）
- 通知点击在双屏布局下路由正确（跳对应窗口而非固定跳主窗口）

## 架构

### 窗口体系（最终形态）

```
主窗口      [会话列表 | tab区(会话tabs + 笔记/数据中心/文章固定右侧组) | 右侧栏(五tab)]
右侧栏(整体) ↔ 工作台窗口      互斥弹出（开=主窗口右栏收起，关=恢复）
笔记 tab    ↔ 笔记窗口        弹出=tab隐藏开窗，关窗=tab恢复
数据中心tab ↔ 数据中心窗口    同上（后端窗口能力已有，补入口）
会话 tab    ↔ 独立会话窗口    已有，布局改版
自选股窗口  已有，不动
```

### 排除的选项

- **主窗口内双会话分屏**：右侧工具栏割裂（话题/终端跟会话走，右栏单锚点无法同时服务两会话）；交给独立窗口 + OS 排布
- **统一工具箱窗口**（笔记/数据中心塞进工作台窗口）：tab 页功能留在 tab 页，各自弹各自窗口，三条线互不掺和
- **一键双屏切换开关**：用户自己组合，不做模式状态

### 既有机制复用（零改动）

- 右栏内部锚点维持现状：文件/附加跟工作区、话题/终端跟焦点会话（右侧一个整体，内容跟随不同）
- 数据同步：broadcastToWindows + 各 store 订阅重拉
- 工作台窗口焦点跟随：focused-conversation-service（已实现）

## 需求清单

### A. 主窗口布局改版

1. 右栏折叠按钮移到 header 最右侧（对称左侧折叠按钮），聊天区内不再放
2. tab 栏：会话 tabs 在左，笔记/数据中心/文章哨兵 tab 固定**最右侧一组**
3. header 缩小、按钮紧凑化；**删除刷新按钮**（文件树已有 workspace-watcher 自动同步）
4. 设置 + 消息中心移到 header **左侧**（与折叠按钮、工作区切换器同侧）；右侧留自选股/数据中心/工作台/微信/右栏开关

### B. 右栏 ↔ 工作台窗口互斥 + 切换态

5. 打开工作台窗口 → 广播 `workbenchWindowOpened` → 主窗口右栏收起、**右栏开关按钮隐藏**、工作台按钮启用高亮态
6. 关闭工作台窗口 → 广播 `workbenchWindowClosed` → 右栏恢复展开、按钮恢复；工作台按钮为切换钮（已启用时点击 = 关窗收回）
7. 互斥对独立会话窗口同样生效（其右侧工具箱同步隐藏/恢复）

### C. 独立会话窗口改版

8. 布局改成与主窗口 tab 内一致：左聊天 + 右 CompanionPanel，**去掉左侧文件树**；ArticlePreview 保留在聊天位
9. 订阅互斥广播

### D. 笔记独立窗口 + 弹出/恢复模式

10. 笔记单例窗口（复用 NotesPanel），照会话 tab 弹出模式：点弹出 → tab 隐藏、开窗口；关窗 → tab 自动恢复（照 sessionWindowClosed 范例广播）
11. 笔记 tab 改可开关（默认开，localStorage 记忆）；所有会话 tab 关完后回空态（EmptyFocusState 已有），不再兜底回笔记
12. 数据中心同款：tab 弹出按钮 + 关窗恢复 tab + **补前端弹出入口**（后端 createDataCenterWindow 已有）
13. 笔记窗口/数据中心窗口加位置记忆（window-state-service 现成，一行调用；工作台已有同款）

### E. 通知点击跨窗口路由

14. `focusTask` → 主进程判断笔记窗口是否打开：在 → focus 窗口 + 广播定位事件（笔记窗口监听后定位任务）；不在 → 走现状（主窗口切笔记 tab）
15. `focusConversation` 不动（会话在主窗口）

## 模块边界

**主进程**
- `electron/main/main-app.ts`：createNotesWindow（新增单例）、workbench/dataCenter 窗口互斥广播与位置记忆、笔记/数据中心窗口 closed 广播
- `electron/main/tipc/windows.ts`：openNotesWindow、笔记窗口状态查询/聚焦（focusTask 路由用）
- `electron/main/tipc/renderer-handlers.ts`：新增 workbenchWindowOpened/Closed、notesWindowClosed、dataCenterWindowClosed、笔记任务定位事件
- 通知点击链路（notification-center-service / tipc/notifications.ts）：focusTask 分流改造

**前端**
- `app/page.tsx`：header 改版（左右分组、删刷新、按钮缩小）、互斥订阅（收/恢复右栏、按钮显隐）、哨兵 tab 恢复订阅
- `components/WorkspaceTabBar.tsx`：tab 分组布局（会话左/哨兵右）、哨兵 tab 弹出按钮
- `app/notes-window/page.tsx`：新页面（照 workbench-window 初始化模式 + 任务定位监听）
- `app/data-center/page.tsx` / 独立窗口页：确认复用结构
- `app/session-window/page.tsx`：布局改版（去文件树、加右栏）+ 互斥订阅
- `stores/session-store.ts`：笔记 tab 可开关、哨兵 tab 弹出中状态
- `components/notes/NotesPanel.tsx`：定位任务事件消费（可能）
- `components/agent-chat/AgentChat.tsx`：移除聊天区内右栏开关（rightPanelToggle 相关）

## 数据流

- **互斥**：createWorkbenchWindow 成功 / window closed → broadcastToWindows(workbenchWindowOpened/Closed) → 主窗口与独立会话窗口的 ui-store 响应（右栏收起/恢复、开关按钮显隐）
- **笔记弹出**：tab 弹出按钮 → openNotesWindow RPC → 单例窗口创建 → notesWindowOpened → 主窗口隐藏笔记 tab；closed → notesWindowClosed → 恢复 tab（数据中心同构）
- **focusTask 分流**：通知点击（主进程）→ 笔记窗口开着：webContents.focus + 广播定位（带 taskId/workspaceId）；没开：广播 focusTask（现状）
- **窗口位置**：window-state-service 按 key（notes-window / data-center-window）存取 bounds，moved/resized 500ms 防抖 + close 补写

## 错误处理 / 边界情况

- 弹出前哨兵 tab 未开（如数据中心 tab 本来关着）：弹出入口仅在 tab 存在时可用；想开窗先 header 开 tab 再弹（两步，接受）
- 弹出中窗口被系统强杀（未触发 closed）：广播已由 closed 事件驱动，若 missed 则主窗口 tab 恢复缺失——openWorkbenchWindow/openNotesWindow 幂等（已存在则 focus），下次操作自愈
- 笔记窗口初始化：照 workbench-window 模式（loadSettings → getDefault → setWorkspace skipSetDefault → 加载笔记列表），不回写默认工作区
- 互斥状态下应用退出重启：窗口不持久，主窗口右栏默认恢复（互斥状态不落盘，重启即单窗口态）

## 未决问题（实施时补）

- 笔记窗口的工作区切换交互：一期照数据中心窗口现状（初始化后不跟随主窗口切区）；若现状数据中心窗口有跟随逻辑则对齐
- focusTask 定位到笔记窗口时目标任务不在当前工作区：一期只按 taskId 定位，找不到 toast 提示
- header 具体尺寸（h-12 → 多小）：实施时按视觉效果定
