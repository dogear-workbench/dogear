---
step: 2
title: 重调层——错误分类 + resumeChild 复活 + 跨供应商降级链
status: done
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

## 实施回填（已做完）

### 实际改动
- 与计划差异：
  - 纯逻辑拆到 `delegation-resume.ts`（决策/降级查找/提示词），错误分类 + MAX_RETRY + quota 关键词按接力棒放 `delegation-terminal.ts`；两者都从 bridge 消费
  - 终态结算统一收敛为 `settleTerminal`（settling 锁防 interrupt 触发的 complete 与 stopChild 主流程双路并发）；stopChild 不再自己 notify/detach，交 settleTerminal 统一处理（重调优先于通知）
  - wireSession 改为可卸载（sessionWirings）：复活复用同一 PiSession 时先 unwire 再 wire，防监听叠加导致双结算破坏 resume
  - 降级路径细节：attachConversation 复用存活 session 时不重读 conversation.modelSelection，所以 quota 降级前先 detachAttachment 让旧 session 销毁，attach 才会以新模型重建（保留 harness 历史续跑）；transient 重试直接复用存活 session 保留内存上下文
  - outputPath reclaim：claim 返回 file_exists 视为本会话部分产出继续复用（复活前刚 release，文件存在本身能挡住其他会话 claim）；仅 claimed_by_other 视为复活失败
  - isNotifiableTerminal 扩为「除 done/running/interrupted 外全部终态」——cancelled（用户手动停）与 no_delivery 也 resolve waiter，与 plan.md「不重调（耗尽/用户取消/no_delivery）才 resolve waiter」对齐
  - resumeChild 里按 modelSel 找 SubAgentProfile 用 `p.modelSelection?.profileId === modelSel.profileId`（modelSelection.profileId 指向 ModelProfile 供应商，不是 SubAgentProfile.id，两个命名空间）
  - 集成测试 mock 抽共享模块 `delegation-test-mocks.ts`：bun test 单进程合跑多文件时 mock.module 先注册者被 bridge 单例绑定，两个测试文件必须注册同一份实现
- 改动文件清单：
  - `electron/main/agents/delegation-resume.ts`（新，50 行）：findFallbackModel / decideResumeOnError / buildResumePrompt
  - `electron/main/agents/delegation-terminal.ts`：MAX_RETRY + set/getDelegationMaxRetry（测试注入）+ QUOTA_ERROR_KEYWORDS + isQuotaErrorMessage + classifyDelegationError；isNotifiableTerminal 扩范围；buildTerminalNotice 接收 errorClass/modelTried 并生成 quota 行动建议文案
  - `electron/main/agents/delegation-bridge.ts`（470→768 行）：onSessionComplete 分类+errorClass 填充；settleTerminal/decideResume/resumeChild/isRetryableStatus；wireSession 可卸载 + sessionWirings；onChildSessionInit 允许复活后 harness sessionId 更新；startChild 初始化 modelTried/retryCount；stopChild 交 settleTerminal；notifyTerminalToWaiters 填真实 errorClass
  - `electron/main/types.ts` + `types/delegation.ts`：ChildStateSnapshot.errorClass 收窄为 'transient' | 'quota' | 'cancelled'
  - `electron/main/agents/delegation-test-mocks.ts`（新）：共享 mock（conversation-service 含 updateModelSelection、可变 settings、按 conv 复用 session 的 attachConversation）
  - `electron/main/agents/delegation-resume.test.ts`（新，10 用例）：5 个验收场景 + stopChild(timeout) 复活 + 4 组纯函数矩阵
  - `electron/main/agents/delegation-idle.test.ts`：改用共享 mock + setDelegationMaxRetry(0)（step1 测试聚焦通知语义，关重调）
  - `tsconfig.electron.json`：exclude 增加 delegation-test-mocks.ts（bun:test 类型不进主进程构建）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `settleTerminal(c)`：终态统一结算（settling 锁 + decideResume + resumeChild 或 notify+unwire+detach）；stopChild/onSessionComplete 都只负责置态，结算全在这里
  - `resumeChild(childId, { reason, modelOverride? })`：复活编排（降级先 updateModelSelection+detach 旧 session、reclaim outputPath、attach、重挂 idleWatch/timeoutTimer、发继续提示）
  - `decideResumeOnError(errorClass, retryCount, modelTried, fallback)`（delegation-resume.ts）纯决策；`findFallbackModel(profiles, currentProfileId)` 返回异供应商 ModelSelection
  - `setDelegationMaxRetry(n)`（delegation-terminal.ts）测试注入，生产恒 MAX_RETRY=2
  - 通知范围已扩到 cancelled/no_delivery；通知文案 quota 分支含「已降级尝试 X → Y」/「无可降级 profile」行动建议（文案里引导 dogear__ResumeSession，step3 落地该工具）
- 下个 step 该从哪里继续：step3 的 delegation-state.json 落盘需把 ChildStateInternal 的 retryCount/errorClass/modelTried/sessionId 一并持久化；ResumeSession 工具可复用 resumeChild 的编排（考虑把 resumeChild 导出或提取）；ListLinkedSessions 合并时注意 modelTried 展示
- 待办或已知限制：
  - dev 环境手动验收（断 API key 派遣→观察自动复活日志→连败后收结构化通知）未做，只完成 script 级测试
  - resumeChild 未从 bridge 导出，step3 若需工具层调复活需先导出
  - 全目录 `bun test electron/` 有 9 个既有失败（categorize-prompt 等记忆提示词测试，stash 验证与本次无关）
