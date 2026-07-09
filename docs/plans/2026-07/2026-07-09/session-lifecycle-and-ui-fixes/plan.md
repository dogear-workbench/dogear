# 会话生命周期解耦 + 状态同步 + UI 小修 实施计划

**目标**：把会话生命周期从 UI 挂载解耦（运行中保活，空闲随 tab 关自然释放），统一状态源避免"关 tab 后圆点还在"的错位，并顺手修 3 个独立小问题（agent 派子会话不刷新列表、图标语义重复、AskUser 无停止入口）。

**架构思路**：C 方案「跑步机模式」—— session 生命周期跟"是否在跑"绑，不跟 UI 挂载绑。状态两层分工：后端一次事件同时驱动全局粗粒度 Set（tab/列表圆点）和会话内细粒度 pendingState（StreamingIndicator / 输入框按钮），语义永远一致。排除的选项：永不 GC（内存无上界）、超时 GC（要维护定时器且有误杀风险）。

**设计文档**：[../session-lifecycle-and-ui-fixes-design.md](../session-lifecycle-and-ui-fixes-design.md)

**涉及模块**：
- 后端：`electron/main/agents/query-based-session.ts` / `electron/main/agents/tools/delegation-tools.ts` / `electron/main/agents/delegation-bridge.ts` / `electron/main/tipc/agent.ts`
- 前端 store：`stores/session-store.ts` / `stores/conversation-store.ts`
- 前端组件：`components/agent-chat/AgentChat.tsx` / `components/agent-chat/hooks/useAgentSession.ts` / `components/agent-chat/AskUserQuestionCard.tsx` / `components/WorkspaceTabBar.tsx` / `components/conversation-list/ConversationRow.tsx`
- 类型：`types/electron-api.ts`

## 步骤索引

- [x] [Step 1: 三个独立小修](./step1-independent-small-fixes.md) — CreateSession 补广播 / agent 图标换 Workflow / AskUser 加停止按钮
- [x] [Step 2: 后端生命周期与事件契约](./step2-backend-lifecycle-and-events.md) — QueryBasedSession 解耦引用计数强杀，统一状态事件广播
- [x] [Step 3: 前端 store + hook 适配](./step3-frontend-adaptation.md) — 删 SessionTab.isStreaming、迁移 WorkspaceTabBar 判断、改写 useAgentSession attach/detach
- [ ] [Step 4: 边界收尾与手测验收](./step4-edge-cases-and-verify.md) — app 退出清理、未决问题回收、手测 golden path

## 全局决策

1. **生命周期真源在后端**：QueryBasedSession 是唯一的存活权威，前端不主动 close，只声明"这个 tab 需要订阅这个 session"。是否需要 destroy 由后端根据"pending 状态 + 前端订阅计数"决定。
2. **状态两层分工不合并**：全局 Set（`conversation-store` 的 `runningConversationIds` / `pendingActionConversationIds`）用于 tab 栏 / 列表行的粗粒度圆点；session 内 `pendingState` 用于 StreamingIndicator / ChatInputArea 的细粒度文案。两者由同一次后端事件同步更新，前端不再有独立的 `SessionTab.isStreaming` 补丁字段。
3. **事件顺序统一**：close session 时先广播 `sessionClosed` 一次原子事件，前端 store 同时清 running / pendingAction 两个 Set，避免 UI 闪烁。
4. **图标唯一化**：agent 派出会话用 lucide `Workflow`，`Bot` 只留给微信 bot 绑定。
5. **AskUser 停止走已有 interrupt 路径**：不新增专用 IPC，复用 `client.interruptQueryBasedSession`，abort → auto-deny 逻辑已就绪。
6. **禁止兼容层**：按项目 CLAUDE.md「开发阶段不做兼容性代码」，`SessionTab.isStreaming` 直接删，不留 deprecated 别名或迁移路径。
7. **不写单测**：验证靠 `bun run build:electron` + `bun run lint` + 手测。
