---
step: 1
title: bridge 保活（retain/release）
status: done
---

## 目标
存在 running 直属子会话期间，父会话 PiSession 不因引用归零被销毁；全部子会话离开 running 后恢复自然销毁。

## 依赖上下文（接力棒输入）
- 设计：`../delegation-lifecycle-fix-design.md` 架构第 2 条
- 现状机制：pi-session-manager.ts:161-175,224-247——release 归零 + settled → `_destroySession` 立即销毁；running 才走 orphan 保活（:170）
- delegation-bridge.ts:67 `childStates` 模块级 Map 是子会话运行态的唯一跟踪源；spawnChild（:500 附近）创建、settleTerminal（:236）终态
- 关键决策回顾：保活粒度=「有无 status==='running' 的直属子会话」，与 childStates 同生命周期；用户显式停止父会话不与保活冲突（销毁后由 Step 3 调起兜底覆盖）

## 计划改动
- [x] pi-session-manager.ts：暴露非 UI 的 retain/release（内部 holder 计数或独立 holdSet，语义与 attach 等价但不算 UI attach；release 时重走既有归零判定）
- [x] delegation-bridge.ts：spawnChild 成功后对父会话 acquire；settleTerminal 使 running 计数归零时 release；childStates 清空/重置路径（rehydrateChildState :648、重启恢复）确保 hold 状态一致，不留泄漏
- [x] 验证路径：任务执行会话派子会话后回合结束（队列已 detach）→ 子会话交付能直接注入唤醒（不再 target_inactive）；全部子会话终态后父会话可被正常销毁

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。额外同步更新了 delegation-test-mocks.ts 的 mock manager（补 acquireHold/releaseHold），否则 delegation-regression.test.ts 走 startChild 时会运行时报错；这是接口扩展的直接后果，不算越界。
- 改动文件清单：
  - electron/main/agents/pi-session/pi-session-manager.ts：新增独立保活计数 `holds: Map<string, number>`（与 refCounts 分开记账）；新增 `acquireHold(sessionId): boolean`（session 不在内存返回 false）与 `releaseHold(sessionId): Promise<void>`（归零时重走与 release 相同的销毁判定：refCount==0 且不 running → _destroySession('natural')，仍 running → orphan 保活等 settled）；release() 归零分支与 maybeCollectOrphan() 增加 isHeld 检查；_destroySession/closeAll 同步清 holds 防泄漏
  - electron/main/agents/delegation-bridge.ts：ChildStateInternal 新增可选字段 `parentHoldSessionId`；新增 acquireParentHold/releaseParentHold helper（release 先置 undefined 再 fire-and-forget，不重复释放、失败不影响主链）；startChild 在 attach 成功拿到 session 后 acquire（此点之后无失败路径，失败回滚无需清理 hold）；settleTerminal 不可复活分支在 detachAttachment 后 release；resumeChild 复活路径（settleTerminal 重调分支提前 return）hold 保持不释放，子会话回 running 后父会话继续保活；rehydrateChildState 重建条目 status='stopped' 无 hold，与「保活粒度 = 有无 running 直属子会话」天然一致，确认无需改动
  - electron/main/agents/delegation-test-mocks.ts：mock manager 补 acquireHold/releaseHold（对齐真实语义：session 存在才可 acquire；releaseHold no-op）
- 验证：bun run lint 0 errors（改动文件零告警）；bun run build:electron 编译通过；bun test delegation-regression/resume/lifecycle 30 pass / 0 fail

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - PiSessionManager.acquireHold(sessionId): boolean / releaseHold(sessionId): Promise<void> / 私有 isHeld(sessionId): boolean；holds 与 refCounts 独立，销毁判定 = refCount==0 && !isHeld && !isRunning
  - ChildStateInternal.parentHoldSessionId?: string —— acquire 成功时记录的父会话 PiSession sessionId（非 conversationId）；release 精确释放该 sessionId，父会话已销毁时为 no-op（_destroySession 已清 holds）
- 下个 step 该从哪里继续：Step 2（队列结算改造，task-queue.ts）；后续 Step 3（delegation-tools.ts target_inactive 对称化 + notifyTerminalToParent 调起）实施时注意：若调起拉起了新父会话 PiSession 且当时仍有 running 子会话，需对新 sessionId 重新 acquireHold（当前 spawnChild 之外的调起路径不建立保活，属已知边界）
- 待办或已知限制：
  - 「曾 release 后又被 dogear__ResumeSession / resumeChildAndDeliver 复活的子会话」running 期间父会话无 hold——该场景父会话通常也已停机，由 Step 3 调起兑底覆盖
  - 用户显式停止父会话（closeSession forced）会清掉 holds，之后子会话交付/终态送达依赖 Step 3 自动调起（设计如此，非缺陷）
