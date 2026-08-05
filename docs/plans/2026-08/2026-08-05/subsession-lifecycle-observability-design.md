# 子会话生命周期与可观测性设计

**背景**：新建普通会话已验证当前渲染进程不再触发 `historyLoaded is not defined`，该问题的源码修正有效。但子会话仍有独立缺陷：正常 `sendMessage()` 在置运行状态后未立刻广播，导致左侧和聊天页可能完全不显示“运行中”；模型在 `agent_end` 中失败时被转成普通消息，随后仍发出 complete，委派桥接层将其误记为 `no_delivery`。晚打开子会话时还需要可靠回放执行中的消息与权限请求。

**目标**：

- 子会话创建后立即、稳定地显示运行态。
- 在子会话执行期间打开其页面，能看到已有流式消息、权限请求和真实运行状态。
- 明确区分成功交付、模型/运行失败、超时、用户取消和“正常完成但未交付”。
- `no_delivery` 必须是可见、可解释的终态，而不是吞没模型错误的兜底状态。
- 父会话和子会话列表在冷启动、切换窗口及实时事件乱序时保持一致。

**架构**：

以 `PiSession` 的每轮执行结果作为唯一终态来源。调用 `prompt()` 前立即发布 `sessionStateChanged(running=true)`；Harness settled 后发布 `running=false`。运行时错误不再仅以普通流消息表达，而是同步记录本轮结构化结果。`sendMessage()` 只在明确成功时发出成功 complete；模型错误、启动异常和中断发出失败结果，携带稳定的错误文本和失败类别。

`delegation-bridge` 不再根据“Promise 已 resolve”推断成功，而是依据结构化终态更新 `ChildStateSnapshot`：成功交付为 `done`，成功但未交付为 `no_delivery`，模型/运行失败为 `failed`，其余保持 `timeout/cancelled`。桥接层在结算后才释放 attachment，避免中途交付或错误事件抢先销毁仍在执行的 session。

前端继续以后端 `sessionStateChanged` 作为 `runningConversationIds` 的唯一权威来源。创建子会话时，列表通过 `childStatusChanged` 获得快照；冷启动通过 `listAllChildren` 补齐。会话行和父会话等待面板均显示终态及 `errorMessage`，尤其对 `no_delivery` 显示“任务已结束但未交付”，并提供查看会话与重试/重新派遣入口的上下文信息。

**模块边界**：

- `electron/main/agents/pi-session/pi-session.ts`：首帧运行状态广播、统一轮次终态、模型错误归类、进行中消息/权限快照。
- `electron/main/agents/pi-session/pi-session-manager.ts`、`electron/main/tipc/agent.ts`：保持主进程到渲染层的状态和消息事件转发，不新增绕过 tipc 的 IPC。
- `electron/main/agents/delegation-bridge.ts`：基于结构化结果结算 child status、保留终态错误、只在安全结算点释放 attachment。
- `electron/main/types.ts`、`types/delegation.ts`：补充终态原因或失败类别，保持主进程与渲染层镜像一致。
- `electron/main/services/conversation-runtime-service.ts`、`electron/main/tipc/conversation-runtime.ts`：晚加入窗口获得进行中消息和待确认权限快照。
- `stores/conversation-store.ts`、`components/conversation-list/ConversationRow.tsx`、`components/agent-chat/AgentChat.tsx`：运行态、失败态、未交付态的状态映射和可见反馈。
- `components/agent-chat/hooks/useAgentSession.ts`、`useSessionMessages.ts`、`useMessageHistory.ts`：历史加载完成后 attach、快照回放去重、错误和权限请求呈现。
- `.claude/rules/session-runtime.md` 与协作 Skill：固化派遣前后验收要求。

**数据流**：

1. `CreateSession` 创建 conversation、预注册 child snapshot、attach PiSession，随后提交任务。
2. PiSession 在提交 prompt 前广播 `running=true`；前端立即点亮会话行和父会话等待计数。
3. 流式消息、工具调用和权限请求经 tipc renderer handlers 广播；晚打开窗口 attach 后收到 live snapshot，再由 reducer 去重。
4. Harness 结算时 PiSession 产出一次结构化终态。桥接层据此将 child 写为 `done`、`failed` 或 `no_delivery`，广播快照并安全 detach。
5. 子会话页面和父会话面板使用同一快照显示完成摘要、错误文本或未交付原因；冷启动后从 bridge 拉取当前快照。

**错误处理 / 边界情况**：

- `running=true` 必须在任何网络请求前发出；即使模型瞬间失败，用户也能看到一次真实的状态转换。
- `agent_end.stopReason='error'` 不能再进入 `no_delivery`；它必须保留服务端错误文本并标记 `failed`。
- 子会话调用正式交付时，只改变交付状态，不中断仍在执行的 prompt；资源释放等待轮次真正结算。
- 任务自然结束且没有 `delivery:true` 才可标记 `no_delivery`。
- 取消、超时、窗口晚加入、父会话不再等待、权限卡住和应用重启均必须有确定状态，不依赖前端乐观写入。
- `historyLoaded` 修正纳入回归验证：切换会话期间旧历史不能被错误用于新会话 attach。

**验收标准**：

- 创建子会话后，不打开子会话页面也能在左侧立即看到运行指示。
- 执行中再打开子会话，可看到已产生的消息和待确认权限，且无重复消息。
- 模型失败显示 `failed` 和具体错误，不显示为 `no_delivery`。
- 正常完成但未交付显示 `no_delivery` 与解释；正式交付显示 `done` 与摘要。
- 取消、超时、交付和失败都不会造成 attachment 泄漏或中途 abort。
- 普通会话、快速切换会话、子会话创建与晚打开场景均不再出现 `historyLoaded` 白屏。

**未决问题**：无。
