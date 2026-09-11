---
step: 3
title: child→parent 自动调起
status: pending
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
- [ ] delegation-tools.ts：target_inactive 分支对称化——目标 contractMetadata.parentSessionId 指向自己（即目标是父会话）时，走 resumeParentAndDeliver（复用 :119 既有模式）
- [ ] delegation-bridge.ts：新增 resumeParentAndDeliver（或参数化既有函数）；notifyTerminalToParent 遇 target_inactive（:374）同样调起注入而非丢弃
- [ ] 回执文案修正：「对方暂时收不到，请稍后重试」在已自动调起成功的场景改为明确成功语义，消除「系统会自动送达」的误导（step1 实录 04:34:57 误读）
- [ ] 验证路径：手动停止/销毁父会话后子会话交付 → 父会话被拉起并收到交付消息；hang 终态通知在父会话死亡后送达

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
