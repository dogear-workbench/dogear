# 会话状态管理修复 实施计划

**目标**：修复 pi-session 迁移后会话生命周期管理的 5 个问题，确保"只有手动停止和自然跑完才会停止会话，其他操作不打断"。

**架构思路**：PiSessionManager 引入 orphan 保活（release 归零时 running 不销毁）；interrupt/close 接通 abortMessageWaits 解死锁；新建/打开会话立即 attach 消除窗口期；提示词引导主会话派遣后 WaitForMessage；切换对话保留旧消息消闪烁。

**涉及模块**：
- `electron/main/agents/pi-session/` — PiSession、PiSessionManager
- `electron/main/agents/delegation-bridge.ts` — abortMessageWaits
- `electron/main/agents/tools/delegation-tools.ts` — 工具描述
- `electron/main/agents/session-append-templates.ts` — 主会话 append 段
- `stores/conversation-store.ts` — newConversation
- `components/agent-chat/hooks/` — useAgentSession、useMessageHistory、useSendMessage

## 步骤索引

- [x] [Step 1: B1 保活机制](./step1-keepalive.md) — PiSessionManager release 归零时 running 不销毁，settled 时收集 orphan
- [x] [Step 2: B2 停止按钮死锁](./step2-interrupt-wait.md) — interrupt/close 接通 abortMessageWaits
- [x] [Step 3: B4 派遣后 WaitForMessage](./step3-prompt-guide.md) — 工具描述 + 主会话 append 段引导
- [x] [Step 4: B3 立即初始化](./step4-eager-attach.md) — 新建/打开会话先 attach 再切 UI
- [ ] [Step 5: O1 切换闪烁](./step5-switch-flicker.md) — useMessageHistory 切换不立即清空

## 全局决策

- 主会话和子会话本质相同，生命周期管理逻辑统一
- 只有两种停止路径：用户手动点停止按钮（interrupt）、agent 自然跑完（settled）。删除会话也停。
- orphan session 事件照常广播，前端按 conversationId 过滤；re-attach 时 liveSnapshot 补回
- `abortWaitsForParent`（cancel 子会话）保留给前端"中断等待"按钮，`abortMessageWaits`（只 resolve 等待）给 interrupt/close
- 实施顺序 B1→B2→B4→B3→O1，前三个互相独立，B3 依赖 B1 的保活语义
