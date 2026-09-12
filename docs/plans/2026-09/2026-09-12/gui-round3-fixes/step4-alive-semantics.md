---
step: 4
title: 绿色存活标识语义修正
status: done
---

## 目标
绿条语义改为「会话被实例化、活着」：alive 判定从「在内存 &&（运行中 || 被 hold）」放宽为「在内存」；运行状态由橙色运行点独立表达。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 4 节
- 现状：pi-session-manager.ts getAliveConversationIds（:265-269）= session 在内存 && (isRunning || 被 hold)；全量广播整体替换（:275-279）；窗口加载拉初值（conversation-store.ts:937-940）
- 消费方（调研发现的，需逐一验证语义）：交付时 target_inactive 判定（delegation-bridge.ts 的自动调起兜底）、其他 grep aliveConversationIds / getAliveConversationIds 的引用点
- 背景知识：UI attach（refCount>0）的会话不会被 _destroySession（pi-session-manager.ts:204-218）；hold/acquire 机制不变，只是不再参与 alive 判定

## 计划改动
- [x] getAliveConversationIds 判定改为「在内存即 alive」
- [x] 广播时机核对：session 创建/attach/destroy 均触发 alive 集合广播，确保新语义下集合实时准确
- [x] 逐点验证消费方：alive 语义放宽后，target_inactive（不在内存才 inactive）等判定行为变化是否安全——内存中空闲会话收到注入会被唤醒处理，预期更准确
- [ ] GUI 验证：打开的空闲会话绿条常亮；跑完的会话若仍打开仍绿；被回收的（无 attach 无 hold 非运行）灭（代码级推断已过，人工目视待主会话回归）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：两点边际补充，无实质偏离：① unbindConversation 补 broadcastAliveSet()（它改 conversationSessionMap 但原不广播，是 map 变动点中唯一广播缺口；当前无调用方，防御性补齐）；② 保留 sessionStateChanged/settled/acquireHold/releaseHold 既有广播调用（新语义下多数不再改变集合，diff 机制自动跳过，零成本防御冗余）。渲染层零改动：ConversationRow 绿条逻辑（isDisplayRunning || isAlive，非运行 alive = emerald）在新语义下自动呈现预期行为。
- 改动文件清单：electron/main/agents/pi-session/pi-session-manager.ts（getAliveConversationIds 判定放宽 + JSDoc 重写 + unbindConversation 补广播）

### 消费方验证结论（逐点）
1. tipc getAliveConversations（delegation.ts:54）：冷启动拉初值管道，语义自动跟随，无改动 ✓
2. conversation-store.ts（aliveConversationIds 存储/订阅/冷启动 ：870/:937）：纯管道，无改动 ✓
3. ConversationRow.tsx 绿条：isAlive 直控，空闲打开=绿、运行=橙、回收=灭，无改动 ✓
4. target_inactive（bridge pushToParentSession ：795）：不消费 alive 集合，用 getSessionIdByConversation+getSession 直查内存态，判定标准与新语义天然一致，行为零变化 ✓
5. delegation-tools.ts:112 自动调起：消费 deliverMessage 返回值，链路同上零影响；内存中空闲会话注入走 sendMessage（idle 时立即生效）✓
6. 全工作区 grep 复核：getAliveConversationIds 引用仅 manager 自身+delegation.ts:54，无其他隐藏消费方 ✓

### 给下一步的接力棒
- 关键签名 / 数据结构：getAliveConversationIds(): string[] = conversationSessionMap 中 sessions.has(sid) 的 convId 集合；广播链 broadcastAliveSet()（sorted-join diff，变化才发）→ aliveConversationsChanged 全量替换 → store.aliveConversationIds；isHeld/holds 记账不再参与 alive 判定，仅存留于销毁判定（release/releaseHold/maybeCollectOrphan），未动
- 下个 step 该从哪里继续：Step 5 执行会话提示词精简（pi-session.ts systemPrompt 组装 + buildGroupContextPrompt 传 selfConversationId），与本 step 无代码交集
- 待办或已知限制：GUI 人工回归三项目视（空闲常亮/跑完仍绿/回收灭）待主会话执行
