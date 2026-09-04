# 伴随工作台独立窗口焦点跟随同步 实施计划

**目标**：独立工作台窗口跟随当前活跃会话（含跨工作区完整跟随），话题 tab / 组数据刷新 / 终端与主窗口侧边栏效果一致。

**架构思路**：主进程维护全局焦点会话状态（「最近一次被激活的会话」，哨兵 tab 不上报即保持），值变化广播 `focusedConversationChanged` 到所有窗口；主窗口焦点联动与 session-window 初始化作为上报源；工作台锚点改为跟随广播，跨工作区时 `setWorkspace(skipSetDefault)` 整套换新。排除项见设计文档取舍表（`../2026-09-04-workbench-window-focus-sync-design.md`）。

**涉及模块**：
- 主进程：新增 `electron/main/services/focused-conversation-service.ts`、`electron/main/tipc/focus.ts`；改 `renderer-handlers.ts`、`tipc/index.ts`
- 渲染层：`stores/conversation-store.ts`（上报）、`app/session-window/page.tsx`(上报)、`app/workbench-window/page.tsx`（跟随消费）、`components/companion/CompanionPanel.tsx` + `TerminalPanel.tsx`（锚点泛化）
- 零改动：TopicPanel / AdditionalFilesPanel / BrowserPanel

## 步骤索引

- [x] [Step 1: 主进程全局焦点状态中心](./step1-focus-service.md) — service + tipc 路由 + 事件类型 + 注册
- [x] [Step 2: 焦点上报源接入](./step2-report-focus.md) — 主窗口焦点联加上报 + session-window 初始化上报
- [x] [Step 3: 工作台跟随消费](./step3-workbench-follow.md) — 锚点改造 + 跨工作区切换 + TerminalPanel 锚点泛化 + 端到端验证

## 全局决策

- **channel 命名**：`focus:setFocused`（入参 `{ conversationId, workspaceId }`）/ `focus:getFocused`（无参，返回 `{ conversationId, workspaceId } | null`）；事件名 `focusedConversationChanged`
- **全局焦点永不置 null**：只被「有会话的激活」覆盖；哨兵 tab（笔记/数据中心）不上报 = 保持最近焦点。会话删除后焦点悬空由渲染层 `find` 不到自然空态，主进程不做清理
- **主窗口行为零变化**：TerminalPanel 未传 `anchor` prop 时所有替换均为等价替换（`activeTabId` 必在 tabs 中）
- **渲染层上报一律 fire-and-forget**（`.catch(() => {})` 或 void + 内部 catch），失败静默不影响主流程
- **广播时机**：`setFocused` 值变化才广播（同值 no-op），无去抖
- 主进程代码改动后需 `bun run build:electron` 重新编译；渲染层走 Vite 热重载
- 接力纪律：每步完成后回填 stepN.md「实施回填」节 + 本文件打勾，接力棒必须写关键签名
