---
step: 4
title: 绿色存活标识语义修正
status: pending
---

## 目标
绿条语义改为「会话被实例化、活着」：alive 判定从「在内存 &&（运行中 || 被 hold）」放宽为「在内存」；运行状态由橙色运行点独立表达。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 4 节
- 现状：pi-session-manager.ts getAliveConversationIds（:265-269）= session 在内存 && (isRunning || 被 hold)；全量广播整体替换（:275-279）；窗口加载拉初值（conversation-store.ts:937-940）
- 消费方（调研发现的，需逐一验证语义）：交付时 target_inactive 判定（delegation-bridge.ts 的自动调起兜底）、其他 grep aliveConversationIds / getAliveConversationIds 的引用点
- 背景知识：UI attach（refCount>0）的会话不会被 _destroySession（pi-session-manager.ts:204-218）；hold/acquire 机制不变，只是不再参与 alive 判定

## 计划改动
- [ ] getAliveConversationIds 判定改为「在内存即 alive」
- [ ] 广播时机核对：session 创建/attach/destroy 均触发 alive 集合广播，确保新语义下集合实时准确
- [ ] 逐点验证消费方：alive 语义放宽后，target_inactive（不在内存才 inactive）等判定行为变化是否安全——内存中空闲会话收到注入会被唤醒处理，预期更准确
- [ ] GUI 验证：打开的空闲会话绿条常亮；跑完的会话若仍打开仍绿；被回收的（无 attach 无 hold 非运行）灭

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
