---
step: 2
title: 前端消息身份与渲染 key 体系
status: pending
---

## 目标

前端 Message 建立稳定 id/entryIds 字段，整条「全局扁平下标」定位链（渲染 key、data-message-id、querySelector 跳转、搜索 matchId、minimap 回调、turnByIndex）迁移到稳定 ID；turnId 稳定化，折叠/展开不再全量重编号。

## 依赖上下文（接力棒输入）

- 前置 step：[step1-main-process-message-id.md] 主进程已 emit `message_id` 事件（含 uuid/role/model/timestamp），历史消息已带 id（user）/sdkUuid+entryIds（assistant），snapshot 带 turnEntryIds。本 step 只消费 `message_id`，turnEntryIds 留给 step 6。
- 关键现状（已核实）：
  - `components/agent-chat/types.ts` Message 无 id 字段；ContentBlock 有可选 `id?`（未使用）。
  - `components/agent-chat/AgentChat.tsx:421` renderMessage `key={index}`。
  - `components/agent-chat/MessageItem.tsx:157` `data-message-id={\`msg-${messageIndex}\`}`；`:230` 搜索高亮前缀 `${messageIndex}-u`。
  - `components/agent-chat/hooks/useChatScroll.ts:208,216` querySelector `[data-message-id="msg-${messageIndex}"]`。
  - `components/agent-chat/hooks/useMessageSearch.ts` SearchMatch 以 messageIndex 定位。
  - `components/agent-chat/turns.ts` Turn.turnId 为 number，collapsed 时从可见区重新从 0 编号。
  - `components/agent-chat/hooks/useVirtualTurns.ts` 全部 Map/Set<number>。
  - `components/agent-chat/MessageMinimap.tsx` currentTurnId: number、onJumpToMessage(messageIndex)。

## 计划改动

- [ ] `types.ts` Message 加 `id?: string`（稳定 ID）、`entryIds?: string[]`。ContentBlock 的 `id?` 保留不动（block 级暂不引入 ID，key 仍用数组下标——block 在消息内部，消息引用稳定后 block 下标稳定性够用）。
- [ ] `transformers.ts` streamReducer：
  - 新增 `message_id` 事件处理：role=assistant → 尾部 isStreaming assistant 原地升级：`id = uuid`、`sdkUuid = uuid`（保持 fork 依赖）、`entryIds = [...(entryIds||[]), uuid]`、`model`/`timestamp` 校正为事件值。role=user → 尾部 user 消息（本地乐观 push 的）`id = uuid` 原地替换。均返回新数组（保持 reducer 纯函数风格），消息对象换新但内容不变。
  - 删除 `assistant_uuid` 死分支（:159-171），类型联合同步清理。
  - `createAssistantMessage`/`createUserMessage` 支持传入 id。
- [ ] 本地乐观 push 点生成临时 ID：`useSendMessage.ts` 的 newUserMessage（两处 push：空闲路径 :411-417 附近、插话路径）与 `applyLiveSnapshot` 外的本地构造消息，加 `id: 'local-' + crypto.randomUUID()`。收到 `message_id` 后原地升级（key 从 local-* 换成 entryId 会 remount 一次该 user 消息，低频可接受；assistant 升级路径 id 变化同样 remount 一次——若实测闪烁明显，退化方案：React key 统一用「首次挂载时冻结的 key 快照」，见下方备选）。
  - 备选方案（若 remount 闪烁）：MessageItem 外包一层 `<StableKeyBox>`，key 取首帧 id 并缓存在父级 Map<messageId, frozenKey>。先不用，实测有问题再上。
- [ ] key 迁移：`AgentChat.tsx:421` `key={message.id ?? \`idx-${index}\`}`（历史消息无 id 的兜底：step1 后历史都有 id，兜底仅防御）。
- [ ] data-message-id 与跳转链：
  - `MessageItem.tsx:157` 改 `data-message-id={message.id}`，props `messageIndex` 更名为可选 `messageId`；
  - `useChatScroll.ts` scrollToMessage 签名 `(messageIndex: number, ...)` → `(messageId: string, ...)`，querySelector 改 `[data-message-id="${messageId}"]`；
  - `AgentChat.tsx` minimap 回调 `onJumpToMessage={(id) => scrollToMessage(id, ...)}`；搜索自动展开 effect 里的 `search.activeMatch.messageIndex` 改用 messageId；turnByIndex 查询点同步。
- [ ] `useMessageSearch.ts`：SearchMatch 的 `messageIndex` → `messageId`（`${message.id}-u-${idx}` 等 id 生成同步改）；`MessageItem`/`ContentBlockItem`/`MarkdownRenderer` 的 matchIdPrefix 从 `${messageIndex}-${blockIndex}` 改 `${messageId}-${blockIndex}`。搜索逻辑本身不动（仍是整表扫描，分层索引留 step 7 后视需要做——纲领阶段 3 的「稳定历史索引」若 step 9 基准显示搜索是瓶颈再实施，避免过度设计）。
- [ ] `turns.ts` buildTurns 稳定化：
  - `Turn.turnId: string`，取 header 消息 `id`（`turn-${headerId}`），无头轮取首个成员 id；无 id 兜底 `turn-idx-${i}`；
  - `memberIdxs: number[]` → `memberIds: string[]`；`turnByIndex: Map<number, number>` → `byMessageId: Map<string, string>`；
  - collapsed 时跳过的消息不再影响后续 turnId 编号（这是本改动核心收益：折叠/展开切换后 turnId 不变，useVirtualTurns 高度缓存不再全清）。
- [ ] `useVirtualTurns.ts`：`visibleTurnIds: Set<string>`、`turnHeights: Map<string, number>` 等全部泛型化到 string；`section` 的 `data-virtual-turn-id` 值已是 string，minimap 的 `Number(sec.dataset.virtualTurnId)` 改回 string。
- [ ] `MessageMinimap.tsx`：currentTurnId 类型、turns 预览循环、jumpTargetIdx → jumpTargetId。
- [ ] `turns.test.ts`：测试数据工厂 u()/a() 补 id（`u('q1')` → id: 'u1' 等），断言改 string turnId。补充用例：折叠/展开切换后同一消息的 turnId 不变。

## 验证

- `bun test components/agent-chat/turns.test.ts` 通过。
- `bun run build:renderer` 通过。
- 手动：长会话滚动、搜索跳转（Ctrl+F 上一个/下一个）、minimap 跳转、compact 折叠/展开（展开后滚动位置不丢）、Fork 按钮仍工作（sdkUuid 链路）、流式输出正常。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- Message.id 的最终语义与各来源取值：
- turnId 的最终生成规则：
- 定位链迁移后 scrollToMessage/SearchMatch 的签名：
- 待办或已知限制：
