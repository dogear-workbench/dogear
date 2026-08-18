---
step: 2
title: 重调层——错误分类 + resumeChild 复活 + 跨供应商降级链
status: pending
---

## 目标

子会话死亡后按错误分类自动复活原会话续跑（不新建副本）；quota 类错误沿 profile 链自动降级到异供应商模型；重试/降级耗尽才通知主会话。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-detection.md] 桥内已有 idleTimer + 终态联动通知（一律通知版）；ChildStateInternal 已有 lastActivityAt/retryCount/errorClass/modelTried
- 本步要接手的入口：`onSessionComplete` 的终态联动段——**在 resolve waiter 之前插入重调决策**
- 关键决策回顾：
  - 降级判定用 `profileId`（一个 ModelProfile = 一家供应商）
  - 模型注入 = 先 `conversationService.updateModelSelection` 再 attach，不改 attachConversation 签名
  - 用户手动 `StopSession`（cancelled）**不自动重调**；hang/timeout 按 transient 处理（重调）
  - `MAX_RETRY = 2`（transient）；quota：降级到异供应商一次，仍 quota 即耗尽

## 计划改动

- [ ] `electron/main/agents/delegation-bridge.ts` 新增（建议放独立段，本文件已 536 行，新逻辑集中在文件尾部新 section，控制单文件不超项目约定太多；若超出 700 行考虑拆 `delegation-resume.ts` 并从 bridge re-export）：
  - [ ] `classifyDelegationError(result: PiSessionTurnResult): DelegationErrorClass`——`error.kind === 'cancelled'` → cancelled；message 命中 quota 关键词表（plan.md 全局决策）→ quota；其余 → transient
  - [ ] `findFallbackModel(currentProfileId: string): ModelSelection | null`——读 settings.subAgent.profiles，按列表顺序找第一个 `enabled !== false && modelSelection.profileId !== currentProfileId` 的 profile，返回其 modelSelection；找不到返回 null
  - [ ] `resumeChild(childId: string, opts: { reason: string; modelOverride?: ModelSelection | null }): Promise<void>`：
    - 前置校验：state 存在且 `status !== 'running'`（幂等保护）；`retryCount` 检查在调用方
    - 状态回 running、清 errorMessage、记 `modelTried.push(profileId:tier)`、`retryCount++`
    - `modelOverride` 存在时 `await conversationService.updateModelSelection(workspaceId, childId, modelOverride)`
    - outputPath reclaim：`groupSharedService.claimOutputPath` 若 `file_exists` 且文件是本会话部分产出——直接 `releaseOutputPath` 后重新 claim（bridge 已有 release，holder 是自己或已释放都安全）；claim 彻底失败则放弃 resume、走通知
    - `conversationRuntimeService.attachConversation(childId, workspaceId, 'desktop', {})` 重新拉起 + `wireSession` + 重挂 idleTimer + 总超时 timer（时长用新 profile 的 timeoutMinutes 若降级换了 profile 模型；否则原值）
    - `sendMessage(继续提示模板)`（plan.md 全局决策里的文案，reason 填实际死因）；fire-and-forget 但 catch 里重新走 onSessionComplete(failed) 保持现有模式
  - [ ] `onSessionComplete` 终态联动段改造（顺序敏感）：
    1. 分类 → 更新 `c.errorClass`
    2. 若 `errorClass === 'transient' && retryCount < MAX_RETRY` → `resumeChild(childId, { reason })` 并 return（不 resolve waiter，不 detach——resumeChild 会重新 attach；注意此时 onSessionComplete 现有的 detach 逻辑要跳过）
    3. 若 `errorClass === 'quota'`：`findFallbackModel` 有结果 → `resumeChild(childId, { reason, modelOverride })` 并 return；无结果或降级后仍 quota（`retryCount >= MAX_RETRY + 1` 或 modelTried 已含 fallback）→ 落到通知
    4. 其余（cancelled / 耗尽 / no_delivery）→ 走 Step 1 的通知路径（terminal.attempts = retryCount，terminal.modelTried 填实际值）
    5. 通知文案按 errorClass 给行动建议：quota → 「疑似供应商费率上限，已尝试降级至 {models} 失败/无可降级 profile，建议更换供应商后用 dogear__ResumeSession 调起或重新派遣」
  - [ ] `stopChild`（用户手动 cancelled）确保不进重调——分类返回 cancelled 天然不重调，验证即可
- [ ] `electron/main/agents/delegation-bridge.ts`：resume 成功时 `broadcastChildStatusChanged` 状态回 running（前端能看到「复活」）

## 验收路径

1. `bun run build:electron` 通过
2. script 级测试 `delegation-resume.test.ts`（沿用 delegation-lifecycle.test.ts mock 模式）：
   - mock complete(failed, '500 Internal') → 断言 resumeChild 被调、状态回 running、waiter 未 resolve
   - 连续 failed 3 次（> MAX_RETRY）→ 断言 waiter 被 resolve 且 terminal.attempts === 2
   - mock complete(failed, '429 rate limit exceeded') + profiles 配两家 → 断言 updateModelSelection 被以异供应商 modelSelection 调用
   - 同上但 profiles 全同一家 → 断言立即通知且文案含「无可降级」
   - stopChild(cancelled) → 断言无 resume、waiter 收到 cancelled 通知
3. dev 环境手动：断供应商 API key 派遣 → 观察 failed → 自动复活日志 → 连败后主会话收到结构化通知

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
