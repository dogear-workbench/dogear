---
step: 2
title: 重放捞回 user header
status: done
---

## 目标

`mergeHistorySnapshotCore` 重放时，从磁盘历史切掉段里捞回 user 消息并按 entryId 锚点归位到 live，修复「外部启动会话运行中查看时 user 消息整条不显示」。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-user-write-live.md] user 消息写入统一进 live；`applyEventToCore` 的 `type:'user'` 分支 target 恒为 live（wechat-bot 等带 content 的 user 事件重放时自动落 live，本 step 只需兜「事件流里根本没有 user 实体」的情况——desktop 自己发的消息在 snapshot 里只有 `message_id`(role:user) 事件）。
- 当前关键文件状态：`useTranscriptState.ts`
  - `mergeHistorySnapshotCore`（:157）：`overlapIndex = findHistoryOverlapIndex(history, turnEntryIds)`，`stable = history.slice(0, overlapIndex)` **丢弃**了 `slice(overlapIndex)` 段（运行中 turn 已落盘部分，含 user header）；snapshotEvents 重放进从空开始的 core；最后 `withChanges(next, stable, next.live, next.pendingActions)`。
  - `findHistoryOverlapIndex`（:143）：从后往前找**第一条**命中 turnEntryIds 的消息（即最新落盘的那条），返回其下标——`slice(0, overlapIndex)` 切掉它及之后的一切。
- 数据事实（已核实）：
  - 磁盘切掉段结构 = `[user(header), assistant…, (被消费的插话 user, assistant…)…]` 交错——turnEntryIds 生命周期是一次完整 run 含插话（`pi-session.ts:767` handleSettled 清空）。
  - 磁盘消息 `id` = entryId（Step2 稳定化决策「Message.id 磁盘对齐」），assistant 的 `entryIds` 数组含其全部 entry。
  - 重放事件流里每条已落盘 assistant 都有对应 `message_id`(assistant) 事件（message_end 时主进程 push 进 liveTurnMessages），所以重放产物中 assistant 的 entryIds 是可靠的插入锚点。
  - 磁盘 user 消息的 entryId 也会出现在重放流的 `message_id`(user) 事件里，但 reducer 找不到目标返回 null，无副作用、不冲突。
- 关键决策回顾：捞回的 user 消息直接用磁盘对象（id 已是稳定 entryId），后续 `message_id`(user) 事件因 `isLocalId` 不满足自动跳过，不会重复插入。不做「主进程补 user 渲染事件」方案（跨主进程 + 去重时序敏感，验证链路长；本次不动主进程）。

## 计划改动

- [x] `useTranscriptState.ts` `mergeHistorySnapshotCore`：保留切掉段 `const cut = overlapIndex >= 0 ? history.slice(overlapIndex) : []`，重放完成后把 cut 中 `role === 'user'` 且有 id 的消息插入 `next.live`：
  - 每条 user 的**锚** = 它在 cut 中前面最近一条磁盘 assistant 的末尾 entryId（即该 assistant `entryIds` 最后一个；前面没有 assistant 则锚为 null）
  - 插入位置 = `next.live` 中 entryIds 含该锚的 assistant 之后；锚为 null 或未命中 → 插 live 开头
  - 多条 user 按 cut 内相对顺序依次插入
  - 捞回时剥离 `isQueued` 标记（磁盘消费过，不应显示排队态）
- [ ] 若逻辑超过 ~15 行，提为同文件导出的纯函数（如 `reinsertCutUsers(live, cut)`），便于单测
- [ ] 单测（`useTranscriptState.test.ts`）：
  - 单轮场景：`history=[u-old, a-old, u-run(id='entry-u'), a-run(entryIds=['entry-a1'])]`，`turnEntryIds=['entry-u','entry-a1']`，snapshot 含 `message_id(user,'entry-u')` + text 流 + `message_id(assistant,'entry-a1')` → 断言 `stable=[u-old, a-old]`，`live[0]` 为 u-run（id='entry-u'），其后为重放 assistant
  - 交错场景：cut 含 `[u1, a1(entryIds=['e-a1']), u2, a2]` → u2 插在 entryIds 含 'e-a1' 的 assistant 之后（顺序正确）
  - 回归：现有「按 entryIds 交集从历史尾部截断并重放 snapshot 顺序」「空 turnEntryIds 不截断历史且不重放 snapshot」两用例行为不变（前者 snapshot 纯 assistant、cut 无 user，捞回逻辑空转）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **锚点回看完整 history 而非仅 cut**（关键修正）：实测发现 `findHistoryOverlapIndex` 从尾部扫描，cut 只含「最后一条落盘 turn 成员及其后」；插话 user（如 u2）命中时，它前面的同 run assistant 留在 stable 侧，仅在 cut 内找锚会得 null 而插错到 live 开头。改为锚点取 user 在完整 history 中前面最近一条磁盘 assistant 的末尾 entryId（stable 侧同 run assistant 的 entry 仍被重放产物覆盖，锚点能解析）。
  2. **增加 turnEntryIds 成员过滤**：只捞 entryId ∈ turnEntryIds 的 user。原因：现有回归用例 cut 含非 turn 尾部消息 u-next，计划要求的「两用例行为不变」与计划正文的「cut 中全部 user 插入」冲突，取前者；语义上也更精确（捞回 = turn 成员限定）。pi 落盘模型（appendMessage 后同步 message_end 入 turnEntryIds）保证真场景不受影响。
  3. **增加按 id 去重**：wechat-bot 带实体的 user 重放时已落 live（id 已被 message_id 升级），捞回会重复，按 live 内 id 相同跳过。
  4. 计划中交错场景测试数据（cut 含整 turn [u1,a1,u2,a2]）在实际 findHistoryOverlapIndex 语义下不可构造（命中点即 turn 尾），改为真实 cut 形态（hit=尾部 user、锚在 stable 侧 assistant）重新设计用例。
- 改动文件清单：
  - `components/agent-chat/hooks/useTranscriptState.ts`：新增导出纯函数 `reinsertCutUsers(live, history, cutFrom, turnEntryIds)`（:148-183）；`mergeHistorySnapshotCore` 重放后调捞回（:196、:202）。
  - `components/agent-chat/hooks/useTranscriptState.test.ts`：新增 3 用例（run header 捞回+剥 isQueued / 插话锚点归位 / wechat 去重）。

### 给下一步的接力棒
- 关键签名 / 数据结构：`reinsertCutUsers(live, history, cutFrom, turnEntryIds)`——live 为重放产物，cutFrom = overlapIndex（-1 时传 history.length 即空转）；插入 user 剥离 isQueued；锚点解析依赖「重放 assistant entryIds 覆盖全部已落盘 entry」。
- 测试：目标文件 13/13 绿；lint 0 error；全量 bun test 的 9 个失败均为 electron/ 既有并发模块解析问题（stash 验证与本改动无关）。
- 下个 step 该从哪里继续：step3（LiveTurn 包 agent-turn + 回归验证）。
- 待办或已知限制：attach 窗口落在「assistant 已落盘、后续 assistant 流式中」时，stable 尾会保留部分 run 内容（如 [.., u-run, a1]）与重放产物的重复为既有行为（overlap 只切尾部命中点），本 step 未动；wechat user 在该窗口下 stable 副本 + live 实体并存同理。均留待后续 step 评估。
