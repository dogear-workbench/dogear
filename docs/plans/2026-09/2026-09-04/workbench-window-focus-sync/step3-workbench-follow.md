---
step: 3
title: 工作台跟随消费
status: done
---

## 目标

工作台窗口锚点改为跟随全局焦点会话（含跨工作区整套切换），终端跟随模式拿到信号源；端到端行为与主窗口侧边栏一致。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-report-focus.md] — 主窗口/独立会话窗口已在激活会话时上报；渲染层可通过 `client['focus:getFocused']()` 拉取、`rendererEvents.focusedConversationChanged.listen(cb)` 订阅（静态 import `@/lib/events`，TopicPanel 先例）
- 当前关键文件状态：
  - `app/workbench-window/page.tsx`：初始化链 loadSettings → getDefault/getAll → `setWorkspace(ws, { skipSetDefault: true })` → `loadConversations()` → `pinConversation(convs[0].id)` + `ensureTerminals()` + `setRightPanelTab('terminal')` → setWorkspaceId(ws.id) 渲染 `<CompanionPanel full workspaceId groupId>`
  - `components/companion/TerminalPanel.tsx:110`：`const anchor = followMode === 'follow' ? activeTabId : pinnedId`；另有两处 activeTabId 引用——pin 按钮 onClick 目标（:144-148，`activeTabId && tabs.some(...)` 判定）、跟随态标题（:153 `activeTab.conversationTitle`）；`reconcileActive(anchor)` 在 terminals/anchor 变化时调
  - `stores/workspace-store.ts:18`：`setWorkspace(workspace: Workspace, options?: { skipSetDefault?: boolean })`，需要 Workspace 对象（`client.getAll()` 可查）
- 关键决策回顾：`anchor` prop 语义用 undefined/null 区分——undefined = 未传（主窗口，回退 activeTabId），null = 明确无锚点（工作台无焦点时空态）；pin 模式优先于跟随不被覆盖

## 计划改动

- [x] `app/workbench-window/page.tsx` 重写跟随逻辑：
  - state 改为 `focusedConv: { conversationId: string; workspaceId: string } | null`（替换原 `workspaceId` state；加载态改由 workspace-store 驱动，见下）
  - 初始化 effect：loadSettings → `client['focus:getFocused']()` 拉焦点 → getDefault/getAll 解析初始工作区（焦点存在且其 workspaceId 有对应 Workspace 时优先用焦点的）→ `setWorkspace(ws, { skipSetDefault: true })` → `loadConversations()` → **删除 `pinConversation(convs[0].id)`**；保留 `ensureTerminals()` + `setRightPanelTab('terminal')` → 标记就绪
  - 订阅 effect：`rendererEvents.focusedConversationChanged.listen((data) => setFocusedConv(data))`（挂载即订阅，卸载 unsubscribe）
  - 跨工作区 effect（依赖 focusedConv）：焦点 `workspaceId` ≠ `useWorkspaceStore.getState().workspace?.id` 时 → `client.getAll()` 查 Workspace 对象 → `await setWorkspace(target, { skipSetDefault: true })` → `await loadConversations()`；查不到 Workspace 静默跳过
  - 渲染层锚点计算：`anchorConvId = focusedConv?.conversationId ?? conversations[0]?.id ?? null`；`groupId = conversations.find((c) => c.id === anchorConvId)?.groupId ?? null`
  - `workspaceId` prop 改读 `useWorkspaceStore((s) => s.workspace?.id) ?? null`，非空才渲染 CompanionPanel
  - 传参：`<CompanionPanel full workspaceId={workspaceId} groupId={groupId} terminalAnchor={anchorConvId} />`
- [x] `components/companion/CompanionPanel.tsx`：props 加 `terminalAnchor?: string | null`，转发 `<TerminalPanel anchor={terminalAnchor} />`（undefined 透传 undefined，不写默认值）
- [x] `components/companion/TerminalPanel.tsx`：
  - 加 props `{ anchor?: string | null }`
  - `const windowAnchor = anchor !== undefined ? anchor : activeTabId;`
  - `:110` anchor 行改 `followMode === 'follow' ? windowAnchor : pinnedId`
  - pin 按钮 onClick 目标改 `windowAnchor ?? pinnedId`（主窗口 activeTabId 必在 tabs 中，等价替换，删掉 tabs.some 检查）
  - 跟随态标题改 `conversations.find((c) => c.id === windowAnchor)` 取 `conversationTitle(conv)`，找不到显示「跟随当前会话」
  - 清理不再使用的 `activeTab` 变量与 `tabs` 订阅（若 pin 按钮外无其他引用）

## 验证（端到端清单）

1. 主窗口开会话 A 聊 → 开工作台：话题 tab 显示 A 的组、终端跟随 A
2. 主窗口切会话 B → 工作台话题 tab 切到 B 的组；B 产生新共享文件/组卡 → 工作台话题 tab 自动刷新（原有广播链路恢复生效）
3. 主窗口切到另一工作区的会话 C → 工作台文件树/话题/终端全套切到 C 的工作区
4. 主窗口切笔记/数据中心 tab → 工作台保持 C（最近焦点）
5. 打开会话 D 的独立窗口聊天 → 工作台跟随 D
6. 工作台终端手动 pin 会话 E → 不被跟随覆盖；取消 pin 恢复跟随
7. 焦点会话被删除/归档 → 工作台话题空态、终端走 reconcileActive 回退链；主窗口切别的会话后恢复
8. 主窗口侧边栏终端行为回归：跟随/pin 切换、标题显示与改造前一致

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **pin 按钮保留有效性校验（未删 tabs.some 检查）**：计划断言「activeTabId 必在 tabs 中」不成立——activeTabId 初始值就是哨兵 `__notes__`，切到笔记/数据中心 tab 时也不在 tabs 中；直接 `windowAnchor ?? pinnedId` 会把哨兵字符串 pin 进 pinnedId（Select 显「选择会话」、会话组永远空的坏状态）。改为 `anchorConv（conversations 查找）存在则 windowAnchor 否则 pinnedId`，数据同源与跟随态标题一致（设计文档未决问题拍板）
  2. TerminalPanel prop 名用 `terminalAnchor`（与 CompanionPanel 一致，设计文档命名），非计划里的 `anchor`
  3. undefined/null 不区分：`terminalAnchor ?? activeTabId`，null 回退 activeTabId（工作台渲染进程无 tabs，activeTabId 恒哨兵、conversations 查不到 → 自然空态，与「null = 空态」效果等价）
  4. 初始化吸收「焦点工作区优先」：Promise.all 并拉 getFocusedConversation，有焦点且能找到 Workspace 则直接落位焦点工作区（消除先默认区再切焦点的闪变）；冷启动拉取合并在 init effect（`setFocusedConv(prev => prev ?? focused)` 防广播先到被旧值回退），订阅 effect 只管广播
  5. 跨工作区 effect 不显式 `await loadConversations()`：setWorkspace 内部已 fire-and-forget 触发，避免双拉
  6. 加载态：`ready || !workspace` 双条件（workspace 改读 workspace-store 响应式值）
- 改动文件清单：`app/workbench-window/page.tsx`（重写跟随逻辑）、`components/companion/CompanionPanel.tsx`（terminalAnchor 透传）、`components/companion/TerminalPanel.tsx`（windowAnchor 三处统一 + 删 tabs 订阅）、`docs/codebase-map.md`（同步索引）

### 给下一步的接力棒
- 关键签名：`CompanionPanel props { workspaceId, groupId, terminalAnchor?, full? }`；`TerminalPanel props { terminalAnchor? }`，内部 `windowAnchor = terminalAnchor ?? activeTabId`
- 下个 step 该从哪里继续：无后续 step，计划完结
- 待办或已知限制：静态验证全过（tsc 双工程 + vite build + eslint 0 error + bun test 271 pass/0 fail）；端到端 8 条清单未人工逐条跑（无人值守环境无 GUI），留待用户审核时按清单验证；主窗口跟随态标题从 `activeTab.conversationTitle` 改为 conversations 查找（设计拍板数据同源，改名广播回环间隙可能短暂滞后）
