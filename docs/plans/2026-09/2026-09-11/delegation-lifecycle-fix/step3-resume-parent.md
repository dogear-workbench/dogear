---
step: 3
title: child→parent 自动调起
status: done
---

## 目标
父会话不在内存（target_inactive）时，子会话交付消息与失败型终态通知都能自动拉起父会话并注入，不再静默丢弃。

## 依赖上下文（接力棒输入）
- 设计：`../delegation-lifecycle-fix-design.md` 架构第 3 条
- 现状机制：delegation-tools.ts:112-136——target_inactive 时仅当「目标是我直接派出的停机子会话」（:114）才 resumeChildAndDeliver 自动调起（rehydrate 兜底 :119 → delegation-bridge.ts:809）；child→parent 方向只回警告（:136）
- 终态通知：delegation-bridge.ts:355 notifyTerminalToParent → pushToParentSession 找不到活会话仅 log warn 丢弃（:374），无重试无落盘
- 实战参照：parent→stopped-child 的 resumeChildAndDeliver 2026-09-11 05:34:19 验证正常——断裂仅在父会话方向的存活前置
- 关键决策回顾：不做离线投递箱；调起 = rehydrate + createSession + start() + 注入，即「唤醒即续跑」

## 计划改动
- [x] delegation-tools.ts：target_inactive 分支对称化——目标 contractMetadata.parentSessionId 指向自己（即目标是父会话）时，走 resumeParentAndDeliver（复用 :119 既有模式）
- [x] delegation-bridge.ts：新增 resumeParentAndDeliver（或参数化既有函数）；notifyTerminalToParent 遇 target_inactive（:374）同样调起注入而非丢弃
- [x] 回执文案修正：「对方暂时收不到，请稍后重试」在已自动调起成功的场景改为明确成功语义，消除「系统会自动送达」的误导（step1 实录 04:34:57 误读）
- [x] 验证路径：手动停止/销毁父会话后子会话交付 → 父会话被拉起并收到交付消息；hang 终态通知在父会话死亡后送达

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - resumeParentAndDeliver 未参数化复用 resumeChildAndDeliver（两者拉起机制不同：子会话走 bridge 的 resumeChild 状态机，父会话走 attachConversation 直拉），共享的是 sender 标签包装 + 注入模式
  - 新增 reacquireParentHolds：调起父会话后把仍 running 直属子会话的非 UI 保活重挂到新 sessionId（Step 1 遗留要求的闭环）
  - bridge 对父会话的 attachment 引用在注入那轮 settled 后释放（有保活时归零引用仍存活，无保活时自然回收），不永久持有父会话
  - 测试同步更新：delegation-resume.test.ts 两个用例改写为新语义（cancelled 终态通知现会经自动调起送达父会话，sendCalls 序号 +1；「父会话方向不调起」用例改写为「自动调起并注入」）；delegation-test-mocks.ts 补 parent 会话 title 字段
- 改动文件清单：electron/main/agents/delegation-bridge.ts、electron/main/agents/tools/delegation-tools.ts、electron/main/agents/delegation-resume.test.ts、electron/main/agents/delegation-test-mocks.ts

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `bridge.resumeParentAndDeliver(parentConversationId, workspaceId, deliverOpts: Omit<DeliverMessageOptions, 'toConversationId'>): Promise<void>`（导出，工具层调用；失败 throw）
  - `reacquireParentHolds(parentConversationId, newSessionId)`（bridge 内部：对仍 running 的直属子会话把 parentHoldSessionId 重挂到新 sessionId）
  - `notifyTerminalToParent` 变 async（settleTerminal 内 await，失败不中断后续清理）
  - delegation-tools target_inactive 分支顺序：先子会话方向（contractMetadata.parentSessionId === ownSessionId），后父会话方向（role='sub' && target.conv.id === opts.parentConversationId），兜底 warning 文案已改为「本次消息未能送达」
- 下个 step 该从哪里继续：按 plan.md 顺序进入 Step 4（存活可视化：aliveSet 广播 + ConversationRow 竖线 + 等待动效）
- 待办或已知限制：
  - 调起父会话的拉起路径无 timeout/idle watch（父会话无此机制），靠注入那轮自然 settled 收尾；若模型 hang 住，父会话 attachment 不会被释放（引用挂到进程重启），属既有 orphan 保活机制的已知边界
  - 应用重启后内存 childStates 丢失：父会话调起不依赖 childStates（attach 直拉）仍可用，但 reacquireParentHolds 因无 running 子会话跟踪而为空操作，保活恢复依赖子会话自身 rehydrate + resume 链路
