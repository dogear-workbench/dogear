# 会话 UI 加载修复 实施计划

**目标**：消灭「假空会话」（尾行读盘竞态 + 前端静默清空）；打开等待期有骨架屏反馈；history 到达即渲染。

**架构思路**：共享 reader 层对 JSONL 尾部半行容错（append-only 末行丢弃不损历史）；error 状态化并渲染错误卡片+重试而非清空；初始化屏障从「history+snapshot 双齐」降为「history 即 ready」（snapshot 后到走既有 timedOut 增量 merge）。排除：改上游 pi-agent-core（容错是读取侧职责）、性能优化项（缓存/IPC 瘦身/虚拟滚动，后续按需立项）。设计全文见 `../session-ui-load-fix-design.md`，根因证据见共享区 `investigate/session-ui-load.md`。

**涉及模块**：session-history-reader.ts、useMessageHistory.ts、useTranscriptState.ts、AgentChat.tsx

## 步骤索引

- [x] [Step 1: reader 尾行容错](./step1-tail-tolerant.md) — 读历史撞上写到一半的尾行不再抛错
- [ ] [Step 2: error 状态化 + 错误卡片](./step2-error-state.md) — 读取失败不清空、显示错误卡片 + 重试
- [ ] [Step 3: 屏障降级 + 骨架屏](./step3-barrier-skeleton.md) — history 先到先渲染，加载期骨架屏

## 全局决策

- 本期只做 bug 类 + 骨架屏；性能优化不进本期（设计文档已界定）
- 尾行容错只在共享 reader（session-history-reader.ts）做，遵循「JSONL 只能经共享 reader」既有决策；非末行损坏维持抛错
- history 是磁盘权威历史，渲染以它为先；snapshot 仅补当前 run
- 空态文案只在 `empty` 显示，`error` 与 `loading` 各自独立 UI
