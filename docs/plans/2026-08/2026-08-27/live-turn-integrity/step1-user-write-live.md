---
step: 1
title: user 消息写入路径统一进 live
status: done
---

## 目标

本地乐观 push 和 `type:'user'` 事件的 user 消息全部落 live（运行中 turn 含 header），消除「user 在 stable 孤立矮 section + 回复在 live」的劈分，同时修复 wechat-bot 消息重放丢失。

## 依赖上下文（接力棒输入）

- 当前关键文件状态：`components/agent-chat/hooks/useTranscriptState.ts`
  - `pushLocalUserCore`（:174）：live 非空 → 先 `promoteCore` 再 push **stable** 尾；live 空 → push **stable** 尾。两处都要改。
  - `applyEventToCore`（:117）`type === 'user'` 分支（:122）：`target = core.live.length ? core.live : core.stable`。改为恒定 live。
  - `applyEventToCore` 的 `message_id + role==='user'` 分支（:127）：已经是「先 live 后 stable」fallback，**保留不动**（见 plan 全局决策）。
  - `structureSignature`（:81）注释「写入口只动 stable 尾部（append/挂块）」需更新为覆盖「pushLocalUser 只动 live」的新事实。
- reducer 侧（`components/agent-chat/transformers.ts`）**不需要改**：
  - `type:'user'` 分支（:227）把消息 push 进**传入的 target 数组**，target 由 applyEventToCore 决定；其中 wechat-bot 渲染（:234）、isQueued 清除（:228，扫整个 target 数组）逻辑在 live 上同样成立（插话排队消息现在也在 live，同一数组内清除）。
  - `message_id`(user) 分支（:176）从后往前找 target 里最后一条 `isLocalId(id)` 的 user 升级——改后本地乐观 user 在 live，直接命中。
- `useSendMessage.ts` 的所有 `pushLocalUser` 调用点（主路径 :312、插话 :245、needsRestart :278、/search 与 SDK 命令）无需改动，自动获得新行为。
- 关键决策回顾：不改 `insertLocalBlockCore`/`appendPendingBlockCore` 的「live 空看 stable 尾」分支（live 空 = 无运行 turn，语义不变）；`handleSend` 空闲路径先 `pushLocalUser` 再 `pushLiveAssistant`，改后 live=[user, 占位assistant] 与插话 promote 后 live=[新user] 都自然成立。

## 计划改动

- [ ] `useTranscriptState.ts` `pushLocalUserCore` 重写：
  - live 空：`withChanges(core, core.stable, [...core.live, msg])`
  - live 非空：`const promoted = promoteCore(core); return withChanges(promoted, promoted.stable, [msg])`（插话 = 旧 turn 提升完结，新消息成为新 turn 的 header，落在 live）
- [ ] `useTranscriptState.ts` `applyEventToCore` 的 `type === 'user'` 分支：target 恒为 `core.live`（`reduceInto(core, core.live, extendedMsg, showReplayMessages, 'live')`），删除 stable 分流
- [ ] 更新 `structureSignature` 处注释
- [ ] 单测（`useTranscriptState.test.ts`，bun:test）：
  - 空闲 push：`stable=[a1] live=[]` → pushLocalUser → stable 不变、`live=[user]`、structuralVersion +1
  - 插话 push：`live=[u1, a1(isStreaming)]` → pushLocalUser(u2) → stable 含 u1+a1（a1 的 isStreaming 已关闭），`live=[u2]`
  - wechat-bot 事件：live 空 + `event('user', { source: 'wechat-bot', content: 'hi' })` → live 新增 user（改前进 stable）
  - 回归：现有用例全绿（注意现有第一个用例「纯 text delta…」构造是 pushLocalUserCore + pushLiveAssistantCore，断言不涉及 stable/live 分布，应不受影响；若断言了 core.stable 则按新语义更新）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 计划三处代码改动全部按原文落地，无逻辑偏差。
  - 额外同步更新了 `message_id + role==='user'` 分支内的注释（原描述「空闲发送时在 stable 尾」在 Step 1 后不再成立，改为「恒落 live + promote 先到时序下保留 stable fallback」），分支逻辑字节不变。
  - 既有用例「新 user 到达时先提升未完成的旧 live」断言按新语义更新（stable=['a-local']、live=['u-new']），计划已预判。
- 改动文件清单：`components/agent-chat/hooks/useTranscriptState.ts`（:73-74 注释、:117 注释、:123-125 user 分支、:175-181 pushLocalUserCore）、`components/agent-chat/hooks/useTranscriptState.test.ts`（:124-168）。
- 测试：`bun test components/agent-chat/hooks/useTranscriptState.test.ts` 10/10 绿；`bun test components/agent-chat/` 30/30 绿；`bun run lint` 0 errors（仅其他文件既有 any 警告）。

### 给下一步的接力棒
- 关键签名 / 数据结构：无签名变化。新语义：live 恒为「运行中 turn（含 user header）」，pushLocalUserCore 两分支均只写 live（live 非空时先 promoteCore）；`type:'user'` 事件 target 恒为 live。
- 下个 step 该从哪里继续：`step2-replay-user-header.md`，`mergeHistorySnapshotCore`（useTranscriptState.ts:150）从切掉段捞 user header；前置条件已满足（带 content 的 user 事件重放自动落 live，只需兑 desktop 自发消息只有 message_id 事件的情况）。
- 待办或已知限制：wechat-bot user 消息 reducer push 时无 id，落 live 后到 message_id 升级前 LiveTail `if (!message.id) return null` 不渲染（短暂窗口；且 pi 广播目前未打 source 标记，该路径实际未激活，见 step6-sdk-main-cleanup.md:63）；Step 3 渲染层如需可顺带评估。
