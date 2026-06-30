---
step: 5
title: 反向通信（AskParent + ReplyToChild）
status: done
---

## 目标

打通子会话主动反问主会话的能力。AskParent 在子会话端挂起 + 同时 push 伪用户消息到主会话；主会话 agent 调 ReplyToChild resolve。

## 依赖上下文（接力棒输入）

- Step 2 在 bridge 留了 `askParent / replyToChild` 空实现，本步填实
- Step 4 已经接入 sendMessageToChild（push 到主→子的 pendingMessages 通道），逻辑对偶但**反向**：现在要 push 到子→主的主会话 pendingMessages
- 设计文档「AskParent / ReplyToChild」数据流一节

## 计划改动

### 1. `electron/main/agents/delegation-bridge.ts`
- `askParent(childId, question): Promise<{ answer: string }>`
  - 校验 child 存在且 status='running'
  - 校验 askPending 里**该 childId 未有 pending**（一次只能问一个，多个未答的同时挂起 reject）
  - 通过同 Step 4 的 mapping 机制，找到**主会话**（child.parentConversationId）的 QueryBasedSession，push 一条伪用户消息：
    ```
    [子会话 反问 · {child.title}（{childId}）]
    {question}

    （请用 ReplyToChild("{childId}", "你的回答") 回复，否则该子会话会一直挂着）
    ```
  - 返回挂起 Promise，存入 askPending map
  - Promise 在 stopChild / timeout / replyToChild 路径都要 settle（避免泄漏）
- `replyToChild(childId, answer): void`
  - 找 askPending[childId]，无则 throw
  - resolve({ answer })
  - 删除 askPending 项
- 在 `cleanupChild(childId)` / `stopChild` / timeout fire 时：检查 askPending 有该 childId 就 reject（带原因 `Error('child cancelled / timed out before reply')`）→ 子会话 AskParent 工具 result 变 isError

### 2. `electron/main/agents/tools/sub-agent-tools.ts`
- 追加 `AskParent` 工具：
  - schema `{ question: string }`（min 1）
  - 调 `bridge.askParent(childConversationId, args.question)`
  - 成功：返回 `📨 主会话回复：\n{answer}`
  - 失败：isError + 原因（已 cancelled / timeout / 已有 pending）

### 3. `electron/main/agents/tools/delegation-tools.ts`
- 追加 `ReplyToChild` 工具：
  - schema `{ childId: string, answer: string }`
  - 校验 child 属于当前 parentConversationId
  - 调 `bridge.replyToChild(childId, args.answer)`
  - 成功：`✅ 已回复 {childId}`
  - 失败：isError + 原因（该子会话没在等回复 / 已 terminal）

### 4. `electron/main/agents/agent-query-config.ts` 或子会话 system prompt
- 在 sub system prompt 增量段补一条：
  ```
  4. 遇到歧义不确定时调 AskParent(question) 反问主会话，不要瞎猜。一次只能问一个问题。
  ```

## 验证

- `bun run build:electron` 通过
- `bun run lint` 通过
- 手测：
  1. 主会话："派一个子会话写 README，但故意在 prompt 里说『如果不知道项目用的什么语言，请反问我』" + DelegateTo readme.md
  2. 子会话开始跑，调 AskParent("项目用什么语言？") → 工具挂起
  3. 主会话 pendingMessages 应收到伪用户消息「[子会话 反问 ...] 项目用什么语言？」
  4. 主会话 agent 自动调 ReplyToChild(childId, "Python")
  5. 子会话 AskParent 解锁，拿到 "Python"，继续完成任务
- 失败路径：
  - 子会话连续调两次 AskParent → 第二次应 isError「已有 pending」
  - 主会话 ReplyToChild 一个没在等的 child → isError

## 实施回填

### 实际改动

**与计划差异**：
- 完全按设计走，没有偏差。
- `clearAskPendingForChild` 抽成单一 helper，三个终结路径（onSessionComplete / onSessionError / stopChild）都调，集中保证 askPending 不会泄漏。
- `replyToChild` 保持同步签名（设计文档原本就是 `void`），不需要 await。
- sub system prompt 增加"第 5 条"AskParent 提示，并明确"一次只能挂起一个"，与 bridge 端 `askPending.has(childId)` 强校验对齐。

**改动文件清单**：
- `electron/main/agents/delegation-bridge.ts`：
  - L42-50：`AskPendingInternal` 加 `reject` 字段；askPending map 去掉 lint disable
  - L52-58：新增 `clearAskPendingForChild(childId, reason)` helper
  - L165 / L181 / L364：三处终结路径插入 `clearAskPendingForChild` 调用
  - L389-431：`askParent` / `replyToChild` 实装（查父 session via `getSessionIdByConversation` → push 伪用户消息 → Promise 挂起池）
- `electron/main/agents/tools/sub-agent-tools.ts`：
  - registerTools 追加 `AskParent` 元数据
  - 新增 AskParent 工具（schema `{ question }`，成功返回 `📨 主会话回复：\n{answer}`）
- `electron/main/agents/tools/delegation-tools.ts`：
  - registerTools 追加 `ReplyToChild` 元数据
  - 新增 ReplyToChild 工具（schema `{ childId, answer }`，校验属于当前主会话）
- `electron/main/agents/query-based-session.ts` L1670：sub system prompt 追加第 5 条 AskParent 提示

### 给下一步的接力棒

- **askParent push 到主会话 pendingMessages 的方式**：`getQueryBasedSessionManager().getSessionIdByConversation(parentConversationId)` → `getSession(sessionId)` → `session.sendMessage(text)`。和 Step 4 的 SendMessageToChild 对偶，没有引入新事件机制
- **父会话未激活的处理**：若 `getSessionIdByConversation` 返回 undefined（如父 tab 关闭、session 被释放回收），AskParent 直接 reject `父会话 ${id} 当前未激活，无法反问`；子 agent 拿到 isError，可以选择不再问，或自行用默认值继续
- **AskParent reject 后子 agent 行为**：现实测试待做。预期 agent 看到 isError 会改走"不问"路径；如果观察到子 agent 反复重试 AskParent，再加"该回合内已 reject 过则后续 AskParent 直接 isError"标记
- **askParent 队列（一次多问）**：目前显式不支持。设计文档也明确"一次只能问一个"，原因是主会话上下文消化伪用户消息有成本，避免子会话刷屏。如果实战中确实需要 batch，可在 Step 5+ 扩展为 `AskParent({ questions: string[] })` 单次返回 answers[]，bridge 端用同一 pending 包多问
- **已知坑 / 待办**：
  - 父会话**关闭对应 tab → session 被 release 销毁**的瞬间，正在挂起的 AskParent 会被 reject。这没有专门覆盖（不属于子会话生命周期），但 Step 6 列表 UI 应该提示用户"父会话关闭会丢失子会话的反问挂起"
  - 父会话同时回复多个子会话的 AskParent 是支持的（askPending 按 childId 分键）
  - 父会话**未及时调 ReplyToChild**时，子会话会一直挂着——直到 subAgent.timeoutMinutes 超时被 stopChild('timeout') 触发，进而 clearAskPendingForChild 兜底 reject。所以最长卡 30 分钟（缺省）
