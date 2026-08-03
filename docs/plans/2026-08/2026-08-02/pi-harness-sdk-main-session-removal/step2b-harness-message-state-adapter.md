---
step: 2b
title: Harness 消息与状态适配
status: pending
---

## 目标

以 AgentHarness 替换 PiSession 的裸 Agent，同时保持 Dogear 消息、插话队列、状态和 usage 事件语义。

## 依赖上下文（接力棒输入）

- Step 2A 已实现 Conversation sessionId 和 PiSession 的 repository create/open 生命周期。
- `pi-harness-adapter-design.md` 定义了 Harness 类型不得泄漏出 PiSession 目录的边界。
- 现有 `PiSession` 的裸 Agent 事件经 `message-converter.ts` 输出 ExtendedSessionMessage，PiSessionManager 负责广播与 usage 落盘。
- 权限状态机在 Step 2C 完成；本步可先保留其现有接口，但不得删除或改变外部事件/方法签名。

## 计划改动

- [ ] 新增 `pi-harness-adapter.ts`，集中构造 AgentHarness 和订阅 Harness 事件，避免 Harness 类型进入 runtime/TIPC/renderer。
- [ ] 使用 repository 返回的 Session、models、tools、system prompt、thinking level 和 streamOptions 构造 Harness；不启用自动 compaction。
- [ ] 将底层 Agent 消息事件映射回现有 message、thinking、tool_use、tool_result、错误和 usage 输入；必要时演进 message-converter，但不得修改渲染层消息协议。
- [ ] 用 Harness `queue_update` 计算 pendingCountChanged，用 `settled` 驱动 running=false 与单轮结算，用 save_point 建立后续关闭落盘边界。
- [ ] 将 sendMessage 的 prompt/steer 路径、interrupt 的 abort/队列清理适配到 Harness 正式 API，保持插话一条条消费的产品语义。
- [ ] 执行 `bun run build:electron`，手动验证文本消息、工具消息、连续插话、usage 和中断状态。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- adapter 的公共内部接口：
- Harness event → Dogear event 映射：
- queue/settled/save_point 时序：
- usage 结算时机：
- 下个 step 入口：Step 2C 将现有权限状态机绑定至 adapter 的 tool_call hook，并验证编辑输入、abort/close 与落盘顺序。
- 待办或已知限制：
