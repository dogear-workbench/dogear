---
step: 3
title: 等待图标与插话交互
status: pending
---

## 目标
等待子会话图标从双层闪烁动效改为旋转；删除点击中断（挂起）功能；插话发送成功提示去掉。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 3、8 节
- 现状：AwaitingDeliveryIndicator.tsx:33-34（外层 animate-ping + 内层 Hourglass animate-pulse），挂载 AgentChat.tsx:539-545，只读态不挂 onAbortWait
- 点击中断链：AgentChat.tsx:152-168 handleAbortWait → client.abortWaitForDeliveries → tipc electron/main/tipc/delegation.ts:40-49 → bridge.abortWaitsForParent（delegation-bridge.ts:812-823，逐个 stopChild('cancelled')）
- 插话成功提示：定位 steer 发送链路的 toast（ChatInputArea/useSteer 相关，实施时 grep steer/插话 toast）

## 计划改动
- [ ] AwaitingDeliveryIndicator：动效改 Loader2 + animate-spin，删 onAbortWait prop 与点击处理
- [ ] 中断链清理：grep abortWaitForDeliveries / abortWaitsForParent 全部消费方——若仅此 UI 入口，tipc 路由与 bridge 方法一并删除；若有他用则仅删 UI 入口并在回填注明
- [ ] 插话成功 toast 删除（保留失败提示，失败仍需可见）
- [ ] 输入区「等待子会话交付中 · 可继续对话」状态行（ChatInputArea.tsx:558-561）保留不动

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
