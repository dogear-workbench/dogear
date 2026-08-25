---
step: 3
title: usage 落盘修复
status: in_progress
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

- [x] **turnIndex 续号**：PiSession 初始化时确定起始值 = 该会话 JSONL 最后一条 ENTRY 的 turnIndex + 1（空文件/读失败回退 0）。实现位置：pi-session-manager attach 时读一次（复用 usage-service 的读取，避免 PiSession 直接依赖文件 IO），通过构造参数或 start 参数传入 PiSession；`usageTurnIndex` 从注入值起自增
- [x] **跳过 0% 快照**：`pi-session.ts:629-637` 的 CTX 生成处，消息带 errorMessage 时跳过（不生成不落盘）
- [x] **CompactMarker 落盘**：`pi-session.ts:898-925` compact_boundary 处理中调 `appendCompactMarker`。preTokens 用压缩前 `extractLastContextTokens` 现值；postTokens 先查压缩摘要消息/CompactionResult 是否自带 tokens（`pi-agent-core/dist/harness/compaction/compaction.js` 的 `CompactionResult.tokensBefore`），拿不到就留空待下一轮 CTX 回填或省略该字段——以实际能拿到的数据为准，不强造
- [x] **lastContextSize 口径**：轮内最后一条 CTX 的 totalTokens 附到 entry 上（`extractPiUsageEntry` 增加入参或在 `pi-session.ts` emitUsageEntry 处带上，entry 结构新增 `lastContextTokens` 字段，types 同步），`applyUsageSummary` 改用该字段（无值回退旧口径，兼容历史 entry）
- [x] 注意 entry 新字段对 `usage-service.ts` readUsage 汇总逻辑与 types（`types/` 下 ConversationUsageEntry 定义，主进程与渲染层两侧若有镜像类型都同步）的影响

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
  1. **CompactMarker 落盘路径**：pi-session 不直接 import usage-service，改为 emit `usageCompact` 事件，由 pi-session-manager 统一 appendCompactMarker + broadcastUsageEntryAdded——与既有 usage/usageContext 事件处理架构对称（IO 收敛在 manager），且前端面板能立即刷到压缩标记
  2. **postTokens 省略**：验证了 `harness.compact()` 返回的 `CompactResult`（pi-agent-core/dist/types.d.ts:581）只有 `tokensBefore` + 摘要调用的 `usage`，无压缩后 tokens；按计划「不强造」原则未加该字段（CompactMarker 类型不变），压缩后大小由下一轮首条 CTX 自然反映
  3. **createSession 改为 async**（读 JSONL 续号需要）；唯一生产调用方 conversation-runtime-service.attachConversation 已 await，无其他调用方
  4. 测试落点调整：applyUsageSummary 测试并入 `usage-service.test.ts` 而非独立文件——bun 全量单进程时 delegation 系列 mock.module 把 conversation-service 换成缺 applyUsageSummary 的部分 mock，独立新文件会文件级 SyntaxError（超出基线 9 个失败）；usage-service.test.ts 本就在基线失败集合内，单文件全绿
- 改动文件清单：
  - `electron/main/services/usage/usage-service.ts`：新增 `readNextTurnIndex(conversationId): Promise<number>`（尾部 ENTRY turnIndex+1，异常/无 ENTRY 回退 0）
  - `electron/main/agents/pi-session/usage-extractor.ts`：`extractPiContextSnapshot` errorMessage 消息直接返回 null；`extractPiUsageEntry` 增加第 6 参 `lastContextTokens?`，有值时附到 entry；顺手修正悬空的累加器注释位置
  - `electron/main/agents/pi-session/pi-session.ts`：PiSessionConfig 新增 `usageTurnIndexStart?`，构造时注入 usageTurnIndex；新字段 `currentRunContextTokens`（message_end 时取轮内最后一条 CTX 的 totalTokens，agent_end/异常时清空）；maybeAutoCompact 成功后 emit `usageCompact`（marker: afterTurnIndex=usageTurnIndex-1, trigger='auto', preTokens）
  - `electron/main/agents/pi-session/pi-session-manager.ts`：`createSession` 改 async，attach 时 `readNextTurnIndex` 续号注入；新增 `usageCompact` 事件处理（appendCompactMarker + broadcast）
  - `electron/main/services/conversation-runtime-service.ts`：await createSession
  - `electron/main/services/conversation-service.ts`：applyUsageSummary / recomputeUsageSummaryIfStale 的 lastContextSize 改为 `entry.lastContextTokens ?? 旧累加口径`
  - `electron/main/types.ts` + `types/usage.ts`：ConversationUsageEntry 新增 `lastContextTokens?: number`（双端镜像同步）
  - `electron/main/services/usage/usage-service.test.ts`：修复既有失败用例（fixture 的 `toolCalls` 是 2026-06-22 token-optimization step2 已删除的旧字段，换成现行 `toolActivity`，断言不变）+ 新增 readNextTurnIndex 3 例、applyUsageSummary 口径 2 例
  - `electron/main/agents/pi-session/usage-extractor.test.ts`（新增）：CTX 快照 errorMessage 跳过 2 例 + lastContextTokens 附带 2 例 + 正常快照 1 例

### 验证结果
- `bun test` 全量：118 pass / 9 fail（基线 113/9，新增 5 例全过且失败集合与基线完全一致，均为 delegation mock 污染）；`bun test electron/main/services/usage/usage-service.test.ts electron/main/agents/pi-session/usage-extractor.test.ts` 单跑 15 pass / 0 fail（含修复的既有用例）
- `bun run lint`：0 errors / 74 warnings（= 基线）
- `bun run build:electron`：✓（主进程有改动，需重启 Electron 生效）
- 手动项（重启后同会话发消息观察 JSONL 尾部 turnIndex）未做，逻辑已由 readNextTurnIndex 单测覆盖

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `readNextTurnIndex(conversationId: string): Promise<number>`（usage-service.ts，尾部 ENTRY turnIndex+1，异常回退 0）
  - `PiSessionConfig.usageTurnIndexStart?: number`（manager 注入；PiSession 不做文件 IO）
  - `ConversationUsageEntry.lastContextTokens?: number`（轮内最后一条 CTX 的 totalTokens；历史 entry 缺失，消费方需 `??` 回退）
  - PiSession 事件 `usageCompact: { conversationId, marker: CompactMarker }`（manager 落盘+广播）
  - `extractPiUsageEntry(accum, turnMessages, turnIndex, fallbackModelId?, resolveWindow?, lastContextTokens?)`
- 下个 step 该从哪里继续：Step 4/5 展示层——`lastContextTokens` 已随 entry 落盘/传输，前端可直接消费；compactMarkers 现有真实数据，CompactRow/crossedCompact 链路可用
- 待办或已知限制：
  - 存量 JSONL 中历史重复 turnIndex 不迁移（新轮次从尾部最大值+1 续号，旧重复仅影响历史排序展示，Step 4 可用时间戳兜底）
  - CompactMarker 无 postTokens（pi 不提供压缩后 token 数）
  - quota 失败轮的 entry 仍落盘（usage 为 0，无 lastContextTokens，applyUsageSummary 回退旧口径）——口径无害但展示层可按 isError 过滤
