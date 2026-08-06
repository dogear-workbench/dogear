# 会话状态管理修复设计

**背景**：迁移到 pi-session 后，会话生命周期管理存在多个状态同步缺陷——关闭/切换对话打断运行中的会话、停止按钮在 WaitForMessage 挂起时死锁、新建会话首条消息静默丢弃、LLM 派遣子会话后不 WaitForMessage、切换对话闪烁。

**核心原则**：主会话和子会话本质相同，区别只在工具集收窄和能力加载。会话生命周期管理（运行/停止/关闭/状态显示）两者完全一致。只有两种情况会停止会话——用户手动点停止按钮，或 agent 这一轮自然跑完。其他一切操作（关 tab、切对话、关窗口）都不应打断正在运行的会话（删除会话除外）。

## B1 保活机制

**根因**：`PiSessionManager.release()` 归零即 `_destroySession()`，关闭 tab / 切换对话 → detach → release 归零 → session 销毁。

**方案**：

`release()` 归零时检查 `session.isRunning()`：
- running 中 → 保留在 sessions Map，refCount 置 0，标记 orphan。`conversationSessionMap` 绑定不摘除，下次 `attachConversation` 通过 `getSessionIdByConversation` 找到并 `retain` 复用。
- 已 idle → 照旧 `_destroySession()` 销毁。

`PiSession.handleSettled()`（turn 自然结束）时通知 Manager：refCount==0 的 orphan session 此时销毁。

`interrupt()` 同理——abort 后 settled → orphan 检查 → 销毁。

新增 `PiSession.isRunning()` 方法：返回 `this.running || this.pendingSteerCount > 0`。

**事件广播**：不改。orphan session 的事件照常广播，前端按 conversationId 过滤自然忽略。re-attach 时 `attachConversation` 返回的 `liveSnapshot` 补回 orphan 期间的消息。复用现有子会话的"静默运行 + 打开后内容对上"模式。

**改动文件**：
- `electron/main/agents/pi-session/pi-session-manager.ts`：`release()` 加 running 检查；新增 orphan 收集入口
- `electron/main/agents/pi-session/pi-session.ts`：`handleSettled()` 调 Manager 收集；新增 `isRunning()`

## B2 停止按钮在 WaitForMessage 挂起时死锁

**根因**：`PiSession.interrupt()` 调 `adapter.abort()` → Harness `waitForIdle()` 等当前工具返回 → 但 `WaitForMessage` 是纯 JS Promise，没有接入 abort 信号 → 永久死锁。

**方案**：

`delegation-bridge.ts` 新增 `abortMessageWaits(parentConversationId)`：只 resolve 等待（`messageWaiters` 里属于该 parent 的全部 resolve(null)），不碰子会话。与现有 `abortWaitsForParent`（resolve 等待 + cancel 子会话，给"中断等待"按钮用）拆开。

`PiSession.interrupt()` 和 `close()` 在 `adapter.abort()` 前调 `abortMessageWaits(this.config.conversationId)`。`WaitForMessage` 工具 handler 拿到 null → 返回超时错误结果 → Harness 收到 tool_result → `abort()` 的 `waitForIdle()` 不再阻塞。

**改动文件**：
- `electron/main/agents/delegation-bridge.ts`：新增 `abortMessageWaits()`
- `electron/main/agents/pi-session/pi-session.ts`：`interrupt()` 和 `close()` 加一行调用

## B3 新建/打开会话立即初始化

**根因**：新建会话只建了 conversation 记录（壳子），attach 推迟到前端 React effect 链（topicStateReady → historyLoaded → attach → ready），中间有异步窗口期。`handleSend` 在 `!isSessionReady` 时静默 return，消息被丢弃。

**方案**：消除窗口期，改为先初始化再切换 UI。

pi 的 `repo.create()` 会立即创建 JSONL 文件，不存在"延迟初始化"的技术限制。旧 SDK 时代的壳子+懒加载模式不再需要。

`newConversation()`：create group + conversation → `attachConversationRuntime`（初始化 session）→ 把 sessionId 写回 conversation → `selectConversation`（切换 UI）。

旧会话切换同理——session 不在内存则 attach，在则复用（B1 保活后切换不销毁 session）。

窗口期消失后，`pendingSendAfterRestart` 排队机制可能不再需要（待实施时确认）。

**改动文件**：
- `stores/conversation-store.ts`：`newConversation()` 改为 attach 后再 selectConversation
- `components/agent-chat/hooks/useAgentSession.ts`：简化 effect 依赖链（attach 不再依赖 topicStateReady/historyLoaded）
- 可能涉及 `useSendMessage.ts`：`pendingSendAfterRestart` 相关逻辑

## B4 LLM 派遣后不 WaitForMessage

**根因**：系统提示词和工具描述没有引导主会话在 CreateSession 后 WaitForMessage。LLM 拿到"已创建"的工具结果后直接 end_turn。

**方案**：

工具描述（`delegation-tools.ts`）：CreateSession 描述加"创建后必须用 WaitForMessage 挂起等待交付"。

主会话系统提示词（`session-append-templates.ts`）：新增子会话协作规范 append 段（只在 `role === 'main'` 且 `groupId` 存在时注入），明确：
1. CreateSession 后立即 WaitForMessage 挂起
2. 子会话 SendMessage(delivery:true) 会通过 WaitForMessage 返回
3. 子会话反问（非 delivery）同样通过 WaitForMessage 收到，回复后再 WaitForMessage 继续
4. 多个子会话可以用一个 WaitForMessage 同时等待多个 sessionId

SendMessage 工具已正确实现两条路径（waiter / queued），不需要改。

**改动文件**：
- `electron/main/agents/tools/delegation-tools.ts`：CreateSession 工具描述
- `electron/main/agents/session-append-templates.ts`：新增主会话协作规范 append 段
- `electron/main/agents/pi-session/pi-session.ts`：`start()` 注入新 append 段

## O1 切换对话闪烁

**根因**：`useMessageHistory` 的 effect 在 conversationId 变化时立即 `setMessages([])`，异步加载完才填回，中间有空白。

**方案**：切换时不立即清空，保留旧消息直到新消息就绪后一次性替换。

**改动文件**：
- `components/agent-chat/hooks/useMessageHistory.ts`：移除 `setMessages([])`

## 实施顺序

B1 → B2 → B4 → B3 → O1

- B1/B2/B4 相对独立，能快速落地
- B3 涉及前端 attach 时序重构，放后面
- O1 收尾（B3 可能改变 useMessageHistory 的使用方式）

## 未决问题

- `pendingSendAfterRestart` 在 B3 后是否还需要（窗口期消失后理论上不需要，但跨 profile 模型切换重启仍可能用到，实施时确认）
- B3 改动 `newConversation()` 在 store 里阻塞等待 attach IPC，UI 切换会有轻微延迟，需实测可接受度
