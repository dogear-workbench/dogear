---
step: 2
title: 焦点上报源接入
status: done
---

## 目标

主窗口切 tab、独立会话窗口打开时，都会把焦点会话上报主进程；哨兵 tab 不上报。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-focus-service.md] — RPC `focus:setFocused`（入参 `{ conversationId, workspaceId }`）与 `focus:getFocused` 已可用，广播事件 `focusedConversationChanged` 已定义
- 当前关键文件状态：
  - `stores/conversation-store.ts:887-908` 有焦点联动 `useSessionStore.subscribe`（activeTabId 变化唯一入口，含通知点击深链/独立窗口收回等所有路径）：async 回调内先取 `tab = useSessionStore.getState().getTab(tabId)`，跨工作区时先 `setWorkspace` 再 `focusConversationById(tabId)`；`client` 已在该文件顶部 import
  - `app/session-window/page.tsx` 的 `init()`：第 4 步 `selectConversation(conv)` 成功后 `setReady(true)`；文件顶部已 import `client`
- 关键决策回顾：上报数据从 tab 自带字段取（conversationId/workspaceId），不依赖也不等待后面的 setWorkspace 时序；哨兵 tab `getTab` 返回 undefined，天然不上报

## 计划改动

- [x] `stores/conversation-store.ts` 焦点联动 subscribe 的 async 回调内、取到 `tab` 之后插入上报：
  - 条件：`tab?.conversationId && tab.workspaceId` 存在才发
  - 调用 `void client['focus:setFocused']({ conversationId: tab.conversationId, workspaceId: tab.workspaceId }).catch(() => {})`
  - 位置放在跨工作区 setWorkspace 逻辑**之前**（tab 数据自足，无时序依赖）
- [x] `app/session-window/page.tsx` `init()`：`selectConversation(conv)` 成功后上报
  `void client['focus:setFocused']({ conversationId: conversationId!, workspaceId: result.workspaceId }).catch(() => {})`
  （一会话一窗口，后续无变化，仅此一次）

## 验证

- 启动应用，主窗口在不同会话 tab 间切换：主进程日志（或 Step 1 临时 log）可见焦点变化，同 tab 重复点击不触发广播
- 切到笔记/数据中心哨兵 tab：不上报，全局焦点保持
- 打开某会话的独立窗口：上报该会话

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 条件简化为 `if (tab)`：tab 存在即 conversationId（tab 的 key 就是 conversationId）与 workspaceId 必有；哨兵/空 tab `getTab` 返回 undefined 天然不上报
  - conversationId 直接用闭包变量 `tabId!`（tab 存在时 tabId 非空），语义同 `tab.conversationId`
- 改动文件清单：`stores/conversation-store.ts`（subscribe 回调取 tab 后、跨工作区 setWorkspace 之前插上报）、`app/session-window/page.tsx`（selectConversation 成功后上报一次，workspaceId 用 result.workspaceId）

### 给下一步的接力棒
- 关键签名：上报调用 `client.setFocusedConversation({ conversationId, workspaceId })`（fire-and-forget）；广播事件 payload `{ conversationId, workspaceId }`
- 下个 step 该从哪里继续：`app/workbench-window/page.tsx` 重写为跟随模式 + `CompanionPanel.tsx`/`TerminalPanel.tsx` 锚点泛化
- 待办或已知限制：session-window 里 selectConversation 内部 openTab 亦会触发同一订阅上报（双保险幂等，主进程同值 no-op）；运行时上报行为未人工验证，静态类型检查 + 测试全过
