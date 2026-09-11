---
step: 4
title: 存活可视化
status: pending
---

## 目标
会话存活状态（含停止态）对用户可见：列表左侧竖线常亮表示存活；等待交付动效从主聊天流挪到 MessageMinimap 同位置侧边区域。

## 依赖上下文（接力棒输入）
- 设计：`../delegation-lifecycle-fix-design.md` 架构第 4 条
- 现状机制：ConversationRow.tsx:119 左侧竖线（选中态指示）；:34 running 橙点 pulse；:65 runningConversationIds 集合驱动
- AgentChat.tsx:138-140 isWaitingForChildren（settled ∧ awaitCount>0）→ :442,:549 传给 StreamingIndicator 显示「等待 N 个交付」+ 中断按钮
- MessageMinimap.tsx 位于聊天区右侧；renderer-broadcast.ts 是既有主进程→渲染层广播通道（try/catch 包裹）
- 关键决策回顾：竖线=存活语义（活着即亮，等待计数归零且空闲/销毁后熄灭）；动效位置与小地图同列，不与消息流打架

## 计划改动
- [ ] electron/main：PiSessionManager 存活集合（内存 Map）变化时经 renderer-broadcast 广播（跟随既有模式定全量/增量）
- [ ] stores/conversation-store.ts：aliveSet 维护 + IPC 订阅
- [ ] ConversationRow.tsx：竖线条件扩展为存活态（颜色/粗细区别于选中态与 running 橙点，出两版对比后定稿）
- [ ] AgentChat.tsx / StreamingIndicator / MessageMinimap 区域：等待交付动效迁移到小地图同位置侧边（中断按钮随迁或保留在输入区，实施时定）
- [ ] 验证路径：父会话等待子会话期间关掉 UI 再看列表（竖线仍亮，若开着其他窗口）；子会话全部终态后竖线熄灭；等待期间小地图侧边有动效、主聊天流无等待文案

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
