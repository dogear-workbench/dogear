---
step: 1
title: 主进程消息级稳定 ID 管道
status: done
---

## 目标

让实时流、live snapshot、磁盘历史三处共享同一套消息级稳定 ID（SessionTreeEntry.id），为前端去重、key 迁移、合并协议打地基。

## 依赖上下文（接力棒输入）

- 必读调研：会话组共享区 `pi-message-pipeline-research.md`（全部结论的代码位置都在里面，本 step 直接引用其 §1/§3/§4/§5/§7）。
- 前置 step：无（本计划第一步）。
- 关键现状（已核实）：
  - `electron/main/agents/pi-session/pi-session.ts:287` getLiveSnapshot 返回 `liveTurnMessages`（delta 级，窗口=完整 run）。
  - `electron/main/agents/pi-session/message-converter.ts:23-58` convertPiEvent 只转 4 种 delta 事件，`message_end` 被丢弃。
  - harness 侧 `agent-harness.js:452-458`：每个 message_end 先 `await session.appendMessage`（返回 SessionTreeEntry）再 emit，返回值被丢弃。
  - `electron/main/agents/pi-session/history-adapter.ts:137-146` user 分支不填任何 ID；`:157-163` 连续 assistant 合并、sdkUuid 只留最后一个 entry.id。
  - `ExtendedSessionMessage` 定义在 `electron/main/agents/task-types.ts:92-178` 与前端镜像 `types/electron-api.ts:63`。

## 计划改动

- [ ] `pi-session.ts` start()（约 410-425 行，session 构造处）：用 Proxy 包一层 session 对象，拦截 `appendMessage(msg)` —— 调原方法后把 `WeakMap<AgentMessage, string>` 记为 `msg → entry.id`，原样返回 entry。代理必须透传其余全部成员（repository.open/create 返回的 session 接口）。
- [ ] `pi-session.ts` 新增 run 级 entryId 累积器（生命周期与 `liveTurnMessages` 完全一致：非运行态 sendMessage 先清空（:813）、handleSettled 清空（:707-714）），message_end 处理时把 entryId push 进去。
- [ ] `pi-session.ts` handleAgentEvent（:601-622）的 message_end 分支：查 WeakMap 拿 entryId，构造并 emit `{ type: 'message_id', uuid, role, model?, timestamp }`（timestamp 用 pi-ai message.timestamp 创建时刻；user 消息的 message_end 同样处理，无 model）。该消息同时 push 进 `liveTurnMessages`，保证 snapshot 重放路径一致。
- [ ] `pi-session.ts` getLiveSnapshot（:287）：返回值新增 `turnEntryIds: string[]`（累积器的拷贝）。
- [ ] `task-types.ts` + `types/electron-api.ts`：`ExtendedSessionMessage` 的 type 联合加 `'message_id'`，补 `uuid` 字段语义注释（从「SDK 提供」改为「harness SessionTreeEntry.id」）；`PiSessionLiveSnapshot` 类型加 `turnEntryIds`。同步 conversation-runtime 链路上 snapshot 的类型透传（`conversation-runtime-service.ts` 返回值 → `conversation-runtime.ts` tipc → 前端 `useAgentSession` 的 onLiveSnapshot 签名，前端消费留到 step 4/6）。
- [ ] `history-adapter.ts`：
  - user 分支（:137-146）填 `id = entry.id`；
  - assistant 合并分支（:157-163）收集完整 `entryIds` 数组（不只最后一个），`sdkUuid` 保持 = 最后一个（fork 兼容），另存 `id = sdkUuid`、`entryIds`；
  - compaction 映射（:67-81）填 `id = compactionEntry.id`（readSessionBranchEntries 返回的 entry 本身带 id，直接用）；
  - trigger 标签修正（:70）：现状 `fromHook ? 'auto' : 'manual'` 语义错位（Dogear 未注册 session_before_compact hook，自动压缩也会显示 manual）。改为：harness 字段能区分则如实映射，不能区分则去掉 manual/auto 标注（渲染层 CompactBoundaryDivider 对 undefined 已兼容——核实后处理）。
- [ ] `pi-session.ts` maybeAutoCompact（:854-876）运行时 `compact_boundary` 事件：补 `uuid = compactionEntry.id`（从 adapter.compact() 返回值取；若拿不到，在 pi-harness-adapter.ts:88-99 订阅 harness own 事件 `session_compact` 携带的 compactionEntry——两条路选一条可行的）。
- [ ] 清理死代码：`assistant_uuid` 类型在 pi 管道从不产生。`task-types.ts` / `types/electron-api.ts` 的 type 联合删掉 `'assistant_uuid'`；前端 `transformers.ts:159-171` 的处理分支在 step 2 一并删除（本 step 只删主进程侧类型定义会让前端类型报错——所以顺序改为：本 step 保留 `'assistant_uuid'` 字符串但标注 deprecated，step 2 删干净。或者本 step 直接把前端死分支一起删——推荐后者，改动小且都在编译器监视下）。

## 验证

- `bun run build:electron` 通过。
- 手动跑一个会话（含工具调用），主进程日志确认：每条 message_end 后 emit 了 message_id；user 与 assistant 都有；snapshot.turnEntryIds 与落盘 JSONL 尾部 entry id 对得上。
- 重新打开同一会话：getConversationHistory 返回的 user 消息有 id、assistant 有 entryIds。

## 实施回填

### 实际改动
- 与计划差异：
  - compact_boundary 的 uuid 采用「订阅 harness own 事件 `session_compact`」路径：实测 harness `compact()` 不返回 compactionEntry（仅返回内部结果对象），返回值路径不可行；`session_compact` 在 `compact()` resolve 前被 await 分发，时序安全。
  - compact trigger 历史映射采用「去掉 manual/auto 标注」：fromHook 只区分「是否由 session_before_compact hook 提供」，Dogear 未注册该 hook 且无手动入口，无法如实区分；同步把渲染层 CompactBoundaryDivider 改为三态，避免 undefined 错标「（自动）」。
  - message_end 的 role=toolResult 不广播 message_id 也不进 turnEntryIds（历史侧 toolResult entry 并入 tool_use 块不独立成消息，保持 live/历史同构）。
  - streamReducer 增加 message_id 静默过滤分支（计划外防御：主进程开始广播后若不过滤会在尾部产生垃圾 block）。
- 改动文件清单（业务 12 文件 +119/-39）：pi-session.ts（Proxy 拦截 appendMessage + WeakMap 反查 + message_id 广播 + turnEntryIds 累积器 + compact_boundary 补 uuid）、pi-harness-adapter.ts（onSessionCompact 回调）、history-adapter.ts（user/compaction 填 id、assistant 合并收完整 entryIds、去 trigger 映射）、task-types.ts / electron-api.ts / conversation-runtime-service.ts / conversation-runtime.ts（类型链透传：assistant_uuid→message_id、新增 role、snapshot 加 turnEntryIds）、transformers.ts（删 assistant_uuid 死分支 + message_id 静默过滤）、ContentBlockItem.tsx（trigger 三态化）、types.ts（Message 补 id/entryIds）、useAgentSession.ts（onLiveSnapshot 第三参）、conversation-store.ts（PreAttachedSession 透传）。验证：build:electron ✓ / lint 0 errors（74 warnings 全存量）/ turns.test.ts 8 pass ✓ / 核心机制（Proxy 透传、WeakMap 命中、turnEntryIds↔JSONL 对齐）InMemorySessionRepo + bun 脚本实测通过。

### 给下一步的接力棒
- message_id 事件字段：`{ type: 'message_id', uuid: SessionTreeEntry.id, role: 'user'|'assistant', model?: string（仅 assistant）, timestamp: number（pi-ai message.timestamp 创建时刻，非 emit 时刻） }`。emit 时机 = message_end 落盘后同步广播（harness 先 appendMessage 后 emit 且同 message 引用，WeakMap 必命中，miss 时 warn 跳过）；同时 push 进 liveTurnMessages，snapshot 重放路径一致；到达位置在尾部 assistant 的 usage 之后、下一组 delta 之前。前端 streamReducer 目前 `return null` 静默过滤，消费逻辑留 step 4/6。
- snapshot.turnEntryIds 的确切形状：本 run 已落盘 user/assistant entry id 按落盘顺序的 string[]，与 messages 同生命周期（非运行态 sendMessage 清空、settled 清空、steer 不清空）；不含 toolResult entry 与 compaction entry；与磁盘 JSONL 尾部逐个相等（已实测）。历史侧 HistoryMessage/Message 新增 `id?`（assistant 合并消息 = 最后 entry id，与 sdkUuid 同值）与 `entryIds?`（user/compaction 单元素，assistant 按落盘顺序全集），fork 的 sdkUuid 语义不变。
- 待办或已知限制：
  - Electron 端到端人工验证待补：真实会话（含工具调用）日志确认每条 message_end 有 message_id、snapshot.turnEntryIds 与 JSONL 尾部对齐、重开会话 user 有 id / assistant 有 entryIds。
  - 主进程/前端两份 ExtendedSessionMessage 联合不一致（前端缺 compact_boundary/compacting/local_command_output）为存量类型债，建议 step 2/4 一并统一。
  - 挂起权限确认 / abort 中途的 turn，已完成部分照常产生 message_id（与磁盘一致）。
