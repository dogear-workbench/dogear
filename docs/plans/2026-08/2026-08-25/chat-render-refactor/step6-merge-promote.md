---
step: 6
title: 合并协议与 live tail 提升
status: pending
---

## 目标

修复「切换到正在流式输出的会话」时 history 与 snapshot 的竞态和重复渲染：两者到齐后按 entryIds 去重合并；live tail 在 settled 且无 pendingActions 时提升为 stableHistory。

## 依赖上下文（接力棒输入）

- 前置 step：[step4-transcript-state.md] useTranscriptState 接口就绪；[step5-stream-batching.md] 事件经 buffer 进入；[step1] snapshot.turnEntryIds 已可用（本 step 开始消费）。
- 调研结论（pi-message-pipeline-research.md）：
  - harness 逐消息实时落盘：snapshot 中已完成 message_end 的部分必然已在磁盘 → 直接重放必重复（现状 bug）。
  - 时序保证：complete 广播时快照已清空、消息已全部落盘。
  - 历史合并消息的 entryIds 是数组（run 内多个 entry 合成一条），去重键是集合交集。
- 关键现状：`useMessageHistory`（loadHistory）与 `useAgentSession` attach 后 `applySnapshot` 两条并发 IPC 顺序无保证（AgentChat.tsx:97-117 + useAgentSession.ts:97-105）。

## 计划改动

- [ ] 合并协议实现（useTranscriptState 内）：
  - 状态机 `init: { history?: Message[]; snapshotEvents?: ExtendedSessionMessage[]; turnEntryIds?: string[] }`，history 与 snapshot 各自到达时暂存，两者到齐（或超时兜底 2s——attach 失败/空会话场景不能卡住渲染）后执行合并。
  - 合并算法：
    ```
    overlap = 消息级扫描 stableHistory 尾部（从后往前），消息.entryIds（或 user 的 id）与 turnEntryIds 交集非空 → 该消息起截断
    stableHistory = 截断后前缀
    liveTail = snapshotEvents 逐条 reduce（applyStreamEvent 语义）
    ```
  - 截断粒度注意：历史消息的 entryIds 与 turnEntryIds 的关系是「历史合并消息 ⊇ 或 ∩ run 的 entry 集合」；只要交集非空就从该消息截断（live 侧会完整重建该 run）。turnEntryIds 为空数组（空闲会话 attach）时零截断、live 空。
  - 本地乐观 push 的 user 消息已在 stable 尾部且收到 message_id 升级过 id 的场景：与磁盘历史同 id → 截断时天然消除重复（本地版被磁盘版替换，key 相同不 remount）。
- [ ] 流事件早到保护：sessionId 就绪但合并未完成期间到达的流事件入 buffer 暂存（复用 step 5 buffer，加一个「init 完成」门槛），合并完成后按序 apply。避免「流事件先于 snapshot 重放导致 block 错位」。
- [ ] 提升实现 `tryPromote`（step 4 留的桩）：
  - 触发：complete 广播（useSessionEvents）且 `pendingActions.length === 0`；若 pendingActions 非空，延迟到全部决议后（resolvePermission/resolveAskUser/中断 里检查触发）。
  - 动作：liveTail 尾部消息关闭 isStreaming → append 到 stableHistory 尾部 → 清空 liveTail → structuralVersion++。
  - 权限/AskUser 决议后的占位 block 更新：决议时把带 resolved 标记的 block 写进对应 live 消息（保持现状视觉），再触发提升检查。
  - 异常兜底：收到新 user push（新一轮 run 开始）而旧 live 未提升（settled 丢失）→ 先强制提升再开新 run。
- [ ] `useAgentSession.ts`：onLiveSnapshot 回调改为「交付 snapshotEvents + pendingPermissionRequests + turnEntryIds」给 transcript 的 init 状态机；pendingPermissionRequests 直进 pendingActions（含外部启动会话场景）。useAgentSession 本身的 attach 逻辑不动。
- [ ] `useMessageHistory.ts`：loadHistory 结果交 init 状态机（与上面同一条通道），彻底消除「非函数式替换冲掉 snapshot」路径。

## 验证

- 核心场景（完成标准里的验收项）：agent 派出子会话运行中，切到该子会话 tab → 消息不丢、不重复、无闪烁；再切走再切回同样正确。
- 普通切换：空闲会话切换渲染与现状一致。
- 提升时序：流式结束 + 权限卡片晚于 result 到达 → 卡片落在 live tail，决议后整体提升，历史边界不被打破。
- 新一轮 run 开始（连续提问）：旧 turn 提升完整、新 turn 正常开启。
- 2s 超时兜底：断点模拟 attach 慢/失败，会话仍可渲染历史。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- init 状态机的最终形态与超时值：
- tryPromote 的全部触发点：
- 待办或已知限制：
