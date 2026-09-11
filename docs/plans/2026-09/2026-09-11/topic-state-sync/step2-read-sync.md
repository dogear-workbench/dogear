---
step: 2
title: 读时同步核心链路
status: done
---

## 目标
删触发器同步等待分支，ReadGroupBackground 改读时同步（stale 则触发抽取并等待，返回唯一最新卡）。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-schema-prompt.md] increment schema 加 initialTitle；提示词已含退休/命名约束
- 当前关键文件状态：`electron/main/services/memory/state-extract-trigger.ts` — SYNC_WAIT_MS=10s / LIGHT_STALE_MAX=2 / submitExtractTask + inFlight（entryKey=wsId:groupId）；`electron/main/agents/tools/reference-tools.ts` 的 dogear__ReadGroupBackground 现为纯读
- 关键决策回顾：分工原则——完整卡只经此工具返回；等待上限 120s，超时返回现有卡+明示；in-flight 复用防并发重复提交

## 计划改动
- [ ] `state-extract-trigger.ts`：删 sync 分支与 SYNC_WAIT_MS/LIGHT_STALE_MAX；保留 submitExtractTask + inFlight；新增导出 `ensureGroupFresh(wsId, groupId, timeoutMs)`：查 getStaleConversations → 空则直接返回 → 非空复用/提交抽取任务并等待（Promise.race timeout 120s）→ 返回 `{ synced: boolean, timedOut: boolean }`
- [ ] `reference-tools.ts` ReadGroupBackground：描述改写（返回话题最新状态卡；存在未提炼会话时将现场抽取并等待，可能 30s~2min）；handler 接 ensureGroupFresh → 读卡 → 返回卡内容 + 提炼至 updatedAt + 未提炼会话标题列表（可再调 ReadReferenceSession 深挖）；超时/失败时返回现有卡 + 明示「以下为 X 时刻状态，N 个会话未提炼未能同步」
- [ ] 检查 ReadGroupBackground 的返回拼装是否需要带六类条目完整渲染（沿用现格式）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：见共享区 topic-state-sync/step2-delivery.md（3 条：导出 deriveStaleList/staleListText 复用、outcome 类型收窄、无卡时也走 ensureGroupFresh）
- 改动文件清单：state-extract-trigger.ts（删 sync 分支 + ensureGroupFresh）、reference-tools.ts（读时同步 + 未同步明示段）、group-context-builder.ts（仅导出 3 个符号，零行为改动）

### 给下一步的接力棒
- 关键签名：`ensureGroupFresh(wsId, groupId, timeoutMs): Promise<{ synced, timedOut }>`；`READ_SYNC_WAIT_MS=120_000` 在 reference-tools.ts
- 下个 step 该从哪里继续：pi-session.ts:398 删调用与 import，可连带删 triggerStateExtractForSessionStart 整函数（step2 未删是为不越界）；group-context-builder 改轻量头时直接复用已导出的 deriveStaleList/staleListText
- 验收：lint 0 errors、build:electron 通过；抽查 ensureGroupFresh 实现（永不抛错/超时留后台/in-flight 去重）、ReadGroupBackground 明示段（超时/失败区分、派生失败不阻塞）均合格
- 待办或已知限制：120s 阈值硬编码；同步期间工具调用阻塞 agent 轮次最长 120s（描述已声明）
