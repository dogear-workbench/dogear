---
step: 2b
title: Harness 消息与状态适配
status: in_progress
---

## 目标

以 AgentHarness 替换 PiSession 的裸 Agent，同时保持 Dogear 消息、插话队列、状态和 usage 事件语义。

## 依赖上下文（接力棒输入）

- Step 2A 已实现 Conversation sessionId 和 PiSession 的 repository create/open 生命周期。
- `pi-harness-adapter-design.md` 定义了 Harness 类型不得泄漏出 PiSession 目录的边界。
- 现有 `PiSession` 的裸 Agent 事件经 `message-converter.ts` 输出 ExtendedSessionMessage，PiSessionManager 负责广播与 usage 落盘。
- Harness 替换必须同时接入完整权限状态机；否则裸 Agent 的 beforeToolCall 被移除会降低产品语义。

## 计划改动

- [ ] 新增 `pi-harness-adapter.ts`，集中构造 AgentHarness 和订阅 Harness 事件，避免 Harness 类型进入 runtime/TIPC/renderer。
- [ ] 使用 repository 返回的 Session、models、tools、system prompt、thinking level 和 streamOptions 构造 Harness；不启用自动 compaction。
- [ ] 将底层 Agent 消息事件映射回现有 message、thinking、tool_use、tool_result、错误和 usage 输入；必要时演进 message-converter，但不得修改渲染层消息协议。
- [ ] 用 Harness `queue_update` 计算 pendingCountChanged，用 `settled` 驱动 running=false 与单轮结算，用 save_point 建立后续关闭落盘边界。
- [ ] 将 sendMessage 的 prompt/steer 路径和 interrupt 的 abort/队列清理适配到 Harness 正式 API，保持插话一条条消费的产品语义。
- [ ] 将完整权限状态机接入 Harness `tool_call` hook，保留 dontAsk、豁免规则、会话 allow、持久 allow、allow、deny、编辑工具输入和前端 `permissionRequest` / `respondPermissionRequest` 的既有语义。
- [ ] 验证编辑工具输入后允许时 Harness 执行器对 input 的传递语义；若不共享引用，使用上游支持的显式改写机制。
- [ ] 执行 `bun run build:electron`，手动验证文本消息、工具消息、连续插话、usage、权限确认、编辑后允许和中断状态。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- adapter 的公共内部接口：
- Harness event → Dogear event 映射：
- queue/settled/save_point 时序：
- usage 结算时机：
- 下个 step 入口：Step 2C 聚焦 abort、close、release 的 pending permission 清理，以及 settled/save_point 落盘顺序。
- 待办或已知限制：
