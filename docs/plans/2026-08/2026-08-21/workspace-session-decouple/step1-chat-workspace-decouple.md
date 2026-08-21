---
step: 1
title: AgentChat workspaceId 解耦
status: done
---

## 目标

AgentChat 的三个 hooks（useAgentSession / useTopicArchiveState / useMessageHistory）不再从全局 workspace store 读 workspaceId，改用会话自身的 workspaceId（tab 携带，props 传入）。切换工作区对已挂载会话零事件：不误报「此话题已删除」、不 detach、运行中 agent 不被打断。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-21/workspace-session-decouple-design.md`（背景/根因/数据流）
- 根因定位（已验证）：
  - `components/agent-chat/hooks/useTopicArchiveState.ts:13` 响应式订阅全局 workspaceId，切换 → effect 重跑 → `getById({会话, 新工作区})` 查不到 → `topicState='missing'` → AgentChat 显示「此话题已删除」（AgentChat.tsx:399/544）
  - `missing → isReadOnly=true → useAgentSession` 的 effect 依赖 `archived` 变化重跑 → cleanup `detachConversationRuntime` → 后端 refCount 归零销毁 session → 运行中 agent 被杀
- 关键现状签名：
  - `useAgentSession(params: { conversationId, archived, setIsLoading, onLiveSnapshot? })`，effect 依赖 `[conversationId, archived, sessionRestartTrigger, onLiveSnapshot]`
  - `useTopicArchiveState(conversationId: string | null)` 返回 `{ conversation, topicState }`，effect 依赖 `[conversationId, groups, knownConversation, workspaceId]`
  - `useMessageHistory({ conversationId })`，effect 依赖仅 `[conversationId]`，workspaceId 在闭包内 `useWorkspaceStore.getState().workspace?.id || ''`（:38）
  - `SessionTab { conversationId, conversationTitle, workspaceId: string, sessionId, attachmentId, permissionMode }`（`stores/session-store.ts`）
  - `AgentChatProps` 定义在 `components/agent-chat/types.ts`
- 关键决策回顾：props 缺省回落全局（`workspaceId ?? 全局`）是为了 debug 页零改动；tab 场景 effective 值恒定所以 effect 不重跑

## 计划改动

- [ ] `components/agent-chat/types.ts`：`AgentChatProps` 加 `workspaceId?: string | null`
- [ ] `components/agent-chat/AgentChat.tsx`：解构 props，传给三个 hooks
- [ ] `components/agent-chat/hooks/useAgentSession.ts:52`：params 加 `workspaceId?: string | null`；`const currentWorkspaceId = workspaceId ?? useWorkspaceStore.getState().workspace?.id`（保持非响应式 getState）
- [ ] `components/agent-chat/hooks/useTopicArchiveState.ts`：签名改 `useTopicArchiveState(conversationId, workspaceId?: string | null)`；内部 `const globalWsId = useWorkspaceStore(s => s.workspace?.id ?? null); const effectiveWsId = workspaceId ?? globalWsId;`；effect 内 getById/getGroup 全用 effectiveWsId；effect 依赖数组把 workspaceId 换成 effectiveWsId
- [ ] `components/agent-chat/hooks/useMessageHistory.ts:38`：params 加 `workspaceId?: string | null`；闭包内 `const wsId = workspaceId ?? useWorkspaceStore.getState().workspace?.id || ''`（注意 `??` 与 `||` 优先级，必要时括号）；effect 依赖保持仅 `[conversationId]`
- [ ] `app/page.tsx`：`allTabs.map(tab => <AgentChat ... workspaceId={tab.workspaceId} />)`
- [ ] `app/session-window/page.tsx`：init 里 `result.workspaceId` 存入 state，渲染 AgentChat 时传入（ready 前不渲染，无 undefined 窗口期）
- [ ] `bun run lint` + 前端手动验证

## 验收清单

- [ ] 工作区 A 会话跑长任务（如让 agent 扫描大目录）→ 顶部切到工作区 B → A 的 tab 不显示「此话题已删除」、运行状态灯仍闪
- [ ] 切回 A（旧交互仍会走 handleTabClick 的 setWorkspace）→ agent 仍在跑、流式内容连续、无 detach 重建迹象（消息不重放）
- [ ] 权限等待中的会话切走再切回，待确认卡片原样
- [ ] 同工作区内点 tab / 切换会话，行为与改动前完全一致（回归）
- [ ] 独立窗口弹出/收回的会话正常（session-window 路径）
- [ ] 重启应用后各 tab 恢复正常

## 实施回填（做完后填）

### 实际改动
- 与计划差异：零实质差异。两点写法说明：① useMessageHistory 回落表达式加括号 `workspaceId ?? (getState()… || '')`（`??`/`||` 混用是语法错误）；② useTopicArchiveState 内变量名 `globalWsId`/`effectiveWsId`，getById/getGroup 调用处显式 `workspaceId: effectiveWsId`
- 改动文件清单：`components/agent-chat/types.ts`、`components/agent-chat/AgentChat.tsx`、`components/agent-chat/hooks/useAgentSession.ts`、`components/agent-chat/hooks/useTopicArchiveState.ts`、`components/agent-chat/hooks/useMessageHistory.ts`、`app/page.tsx`、`app/session-window/page.tsx`（+26/-13）
- 边界记录（设计未覆盖，未扩大改动面）：
  1. useAgentSession/useMessageHistory 的 effect 依赖不含 workspaceId（闭包捕获），前提是「同一挂载组件的 props.workspaceId 运行期不变」——当前所有调用点满足；未来若有 props 动态变化的调用点需加依赖（tab 场景勿加，会引入重挂载风险）
  2. useTopicArchiveState 依赖中 `groups` 仍是全局 group store，切工作区时 groups 被覆盖 → effect 重跑但查询用 effectiveWsId 结果正确，输入区短暂闪「正在检查话题状态…」——设计文档「错误处理 1」已预告，非缺陷
  3. 仓库既有 tsc 错误约 12 处（git stash 对比确认为存量，含 useAgentSession 的 ExtendedSessionMessage 双导出不匹配），本次未引入未修复

### 给下一步的接力棒
- 关键签名 / 数据结构：
  ```ts
  AgentChatProps { ..., workspaceId?: string | null }
  useTopicArchiveState(conversationId, workspaceId?) // 依赖 [conversationId, groups, knownConversation, effectiveWsId]
  useMessageHistory({ conversationId, workspaceId? })  // 依赖仅 [conversationId]
  useAgentSession({ ..., workspaceId? })               // 依赖未动
  ```
- 下个 step 该从哪里继续：WorkspaceTabBar.handleTabClick 删切换逻辑直接 switchTab；conversation-store 底部 activeTabId 订阅 async 化，铁律先 `await setWorkspace(目标)` 后 `focusConversationById`；本 step 后切工作区对已挂载 AgentChat 已零事件，联动可安全引入
- 待办或已知限制：`sessionRestartTrigger` 全局广播机制未动（现状行为，非本计划范围）；手动验收 6 项需跑 dev 人工验证，代码级验收（diff/lint/范围）已过
