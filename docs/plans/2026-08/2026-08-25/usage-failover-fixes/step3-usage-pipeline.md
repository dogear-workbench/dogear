---
step: 3
title: usage 落盘修复
status: pending
---

## 目标

usage JSONL 落盘口径正确：turnIndex 全局单调、失败轮不落 0% 快照、compact 事件落盘、conversations.json 的 lastContextSize 反映真实上下文大小。这是 Step 4/5 展示层的数据前提。

## 依赖上下文（接力棒输入）

- 调查报告（共享区 `usage-correctness-and-display.md`）§1.2 ④⑤⑥⑦ 与 `failover-investigation.md` §4 A2/A4：
  - `usageTurnIndex` 是 PiSession 实例字段（`electron/main/agents/pi-session/pi-session.ts:254`，emit 处 :777），重启/failover 都从 0 重计；JSONL 按 conversationId 追加（`pi-session-manager.ts:118-124` → `usage-service.ts:73-89` appendEntry），实机已见 `0,1,2,0` / `0,0,1` 重复
  - CTX 快照生成：每条 assistant `message_end` 都生成（`pi-session.ts:629-637`）；quota 失败时 harness 持久化的空 assistant 失败消息（`agent-harness.js:15-40`）会产生 `total=0 pct=0` 的假快照
  - `appendCompactMarker`（`usage-service.ts:93`）无生产调用方；pi 自动压缩只 emit `compact_boundary` 消息（`pi-session.ts:898-925`）
  - `applyUsageSummary`（`conversation-service.ts:677-703`）的 `lastContextSize` 用轮内累加值，实测虚高 9.5 倍；前端目前零消费该字段
  - JSONL 文件位置：`.dogear/usage/{conversationId}.jsonl`，ENTRY 行与 CTX 行混排，`readUsage` 只保留最后一条 CTX 为 latestContext（`usage-service.ts:194`）

## 计划改动

- [ ] **turnIndex 续号**：PiSession 初始化时确定起始值 = 该会话 JSONL 最后一条 ENTRY 的 turnIndex + 1（空文件/读失败回退 0）。实现位置：pi-session-manager attach 时读一次（复用 usage-service 的读取，避免 PiSession 直接依赖文件 IO），通过构造参数或 start 参数传入 PiSession；`usageTurnIndex` 从注入值起自增
- [ ] **跳过 0% 快照**：`pi-session.ts:629-637` 的 CTX 生成处，消息带 errorMessage 时跳过（不生成不落盘）
- [ ] **CompactMarker 落盘**：`pi-session.ts:898-925` compact_boundary 处理中调 `appendCompactMarker`。preTokens 用压缩前 `extractLastContextTokens` 现值；postTokens 先查压缩摘要消息/CompactionResult 是否自带 tokens（`pi-agent-core/dist/harness/compaction/compaction.js` 的 `CompactionResult.tokensBefore`），拿不到就留空待下一轮 CTX 回填或省略该字段——以实际能拿到的数据为准，不强造
- [ ] **lastContextSize 口径**：轮内最后一条 CTX 的 totalTokens 附到 entry 上（`extractPiUsageEntry` 增加入参或在 `pi-session.ts` emitUsageEntry 处带上，entry 结构新增 `lastContextTokens` 字段，types 同步），`applyUsageSummary` 改用该字段（无值回退旧口径，兼容历史 entry）
- [ ] 注意 entry 新字段对 `usage-service.ts` readUsage 汇总逻辑与 types（`types/` 下 ConversationUsageEntry 定义，主进程与渲染层两侧若有镜像类型都同步）的影响

## 验证

- 单测（usage-service / pi-session 已有测试文件模式）：
  - turnIndex 续号：预写含 ENTRY turnIndex=2 的 JSONL → 新建 session emit → 落盘 turnIndex=3
  - errorMessage 消息不产 CTX 快照
  - entry 带 lastContextTokens 且 applyUsageSummary 采用
- 手动：重启应用后同会话发消息，JSONL 尾部 turnIndex 不归零（可在开发目录 `.dogear/usage/` 观察）
- lint / 既有测试 / build:electron

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
