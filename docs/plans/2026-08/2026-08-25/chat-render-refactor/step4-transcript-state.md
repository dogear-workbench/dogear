---
step: 4
title: TranscriptState 拆分
status: pending
---

## 目标

把单一 `messages` 状态重构为 `stableHistory + liveTail + pendingActions` 的 `useTranscriptState` hook，全部消息写入口收敛到该 hook；对外提供合成视图 `messages` 保持 AgentChat 旧渲染逻辑不变（兼容期，性能收益在 step 7）。

## 依赖上下文（接力棒输入）

- 前置 step：[step3-task-derived-state.md] task 写回链路已断（没有 effect 反向 setMessages），消息有稳定 id。
- 前置 step：[step1] `message_id` 事件已在流中；snapshot 带 turnEntryIds（本 step 暂不消费 turnEntryIds，合并协议在 step 6；本 step applyLiveSnapshot 先保持「直接重放」现状，竞态修复推迟到 step 6 一起做——注意：step 6 完成前「切换到运行中会话」的重复渲染缺陷维持现状，不要在本 step 引入新的过渡桥接）。
- 关键现状（已核实）：
  - `useMessageHistory.ts`：conversationId 变化 → getConversationHistory → `setMessages(result.messages)` 非函数式替换。
  - 写 messages 的全部入口：`useSessionMessages.ts:37`（streamReducer）、`AgentChat.tsx` applyLiveSnapshot（:97-117）、`useSessionEvents.ts`（complete 关流式 :43-58 / permissionRequest :60-105 / askUserQuestion :107-152）、`useSendMessage.ts`（乐观 push / 权限响应 map / 中断 map / 斜杠命令）。
  - 事件归属表见 `plan.md` 全局决策。

## 计划改动

- [ ] 新建 `components/agent-chat/hooks/useTranscriptState.ts`：
  ```ts
  interface TranscriptState {
    stableHistory: Message[];
    liveTail: Message[];          // 当前 run 的流式消息（通常 0-1 条 assistant）
    pendingActions: PendingAction[]; // 未决权限/AskUser（requestId 关联）
    // 对外兼容视图（step 4-6 兼容期专用，step 7 拆掉）
    messages: Message[];          // useMemo [...stable, ...live]
    // 写入口（全部收敛到这）
    loadHistory(msgs: Message[]): void;        // 替换 stable + 清空 live（/clear、切会话）
    applyStreamEvent(e: ExtendedSessionMessage): void;  // 按归属表分流，内部仍走 streamReducer 语义
    applySnapshot(events: ExtendedSessionMessage[]): void; // 过渡期：直接重放（step 6 改协议）
    pushLocalUser(msg: Message): void;         // 乐观 push 到 stable 尾部
    resolvePermission(requestId, behavior, extra?): void;
    resolveAskUser(requestId, answers | cancelled): void;
    markAllPendingCancelled(): void;           // 中断
    insertLocalBlock(block: ContentBlock): void; // 模式切换通知 / compacting 等本地块 → live tail
    tryPromote(): void;                         // settled 且无 pending → live 并入 stable（本 step 先实现，时序挂在 complete 监听上）
  }
  ```
  实现要点：内部 `useState` 两个数组 + `useRef` 镜像（供回调读最新值）；`applyStreamEvent` 维持 streamReducer 纯函数复用——live 事件 reduce 到 liveTail（streamReducer(prev=liveTail, ...)），compact_boundary / message_id(user) 等按归属表操作 stable 或 live；返回 `result === prev` 时跳过 setState。
- [ ] `useMessageHistory.ts`：去掉内部 messages state，返回 historyStatus + 把 result.messages 交给 transcript.loadHistory 的桥（或 AgentChat 直接调 loadHistory）。historyLoaded 语义保持。
- [ ] `AgentChat.tsx`：
  - 接入 useTranscriptState，`messages` 从合成视图取；
  - applyLiveSnapshot 改调 `applySnapshot`；
  - `useSessionMessages` 简化为「事件 → transcript.applyStreamEvent + result 时 setIsLoading(false)」（本 step 不做批处理，逐事件直通，行为与现状一致）；
  - `useSessionEvents` 权限/AskUser 分支改为写 pendingActions + live tail 挂占位 block（保持现有「无 assistant 时 push 新 isStreaming assistant」行为——归属到 live tail）；complete 分支调 `tryPromote` + 关闭流式；
  - `useSendMessage` 的 setMessages 调用点全部换成对应写入口（乐观 push / resolvePermission / markAllPendingCancelled / insertLocalBlock）；
  - `hasPendingUserAction` 改从 `pendingActions.length > 0` 派生（原来是全表 some 扫描）。
- [ ] `useSendMessage.ts`：参数里的 messages/setMessages 移除（messagesRef 需求改为从 transcript hook 取只读镜像或保留传入合成视图 ref——保留现状最小改动：仍传合成 messages 引用，仅去掉 setMessages）。
- [ ] StreamingIndicator 的 `lastBlockType` 取 `liveTail` 尾部（不再从整表取）。
- [ ] task 派生（step 3 遗留的每帧扫描）：`aggregateTasks` 的 useMemo 依赖改为 `[stableHistory, liveStructureVersion]`——liveTail 引用每帧变但结构（block 数量与 Task* 块内容）低频变；实现：transcript 暴露 `structuralVersion`（stable append / live 新 block / compact / promote 时 +1，纯 text delta 不变），tasks 派生依赖 `[stableHistory, structuralVersion]`。这是纲领「结构快照」概念的落地。

## 验证

- `bun run build:renderer` 通过。
- 手动全链路回归：普通对话、插话（排队→消费）、权限卡片（含外部启动会话无 assistant 占位的 push 路径）、AskUser、中断、/clear、/compact、模型切换重启（needsRestart 路径）、切换会话、错误路径（发送失败移除占位）。
- 行为与现状一致：本 step 是结构迁移，无用户可见变化（除 hasPendingUserAction 语义等价替换）。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- useTranscriptState 的最终接口签名与 structuralVersion 触发点清单：
- pendingActions 的数据结构与占位 block 的关联方式：
- 待办或已知限制：
