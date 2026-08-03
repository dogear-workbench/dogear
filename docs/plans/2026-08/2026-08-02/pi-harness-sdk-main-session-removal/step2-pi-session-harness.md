---
step: 2
title: Harness 驱动 PiSession
status: pending
---

## 目标

在不改变 TIPC 和前端会话协议的前提下，让 PiSession 使用 AgentHarness 运行、持久化和恢复主会话。

## 依赖上下文（接力棒输入）

- 前置 step 产出：`pi-session-repository.ts` 已封装经真实类型验证的 Harness repo create/open/delete/fork，并记录了实际 hook、事件和 flush API。
- 当前 PiSession 的 Dogear 协议包括 `message`、`permissionRequest`、`pendingCountChanged`、`sessionStateChanged`、`sessionClosed`、`usage`、`usageContext`，见 `electron/main/agents/pi-session/pi-session.ts`。
- `PiSessionManager` 负责将上述事件广播到多渲染窗口并写入 usage JSONL，见 `electron/main/agents/pi-session/pi-session-manager.ts`。
- Harness 类型不得泄漏到 TIPC、store 或 React 组件。

## 计划改动

- [ ] 扩展 PiSessionConfig，使创建/恢复会话能接收 workspaceId 和已有 `sessionId`，并在 start 时通过 repository create/open 获得 Harness session。
- [ ] 将裸 `Agent` 的构造、订阅和 prompt 驱动替换为 Harness 对应 API；保留 `PiSession` 对外的方法签名和 EventEmitter 事件名。
- [ ] 将当前 `beforeToolCall` 权限状态机迁移到 Harness `tool_call` hook：维持 dontAsk、豁免规则、会话 allow、持久 allow、前端确认、取消和关闭时 reject 的行为。
- [ ] 验证“编辑工具输入后允许”的语义；若 Harness hook 不共享原始参数引用，改为其支持的显式参数改写返回值，不能静默丢失编辑功能。
- [ ] 维持现有 message converter 的 Dogear ExtendedSessionMessage 输出；补充 Harness 事件到 message、thinking、tool_use、tool_result、错误和 settled 状态的适配。
- [ ] 维持插话队列、running/flushing 状态和 usageContext/usage 事件的产品语义；基于 Harness 真实事件顺序消除裸 Agent 的 timing 假设。
- [ ] 为会话关闭、interrupt、异常与 release 场景补齐 flush / abort / pending permission 清理，确保已完成消息先落盘再释放。
- [ ] 不启用自动 compaction；若 Harness 必须配置阈值，设为明确不会在此阶段触发的值并记录。
- [ ] 执行 `bun run build:electron`，手动验证新建、发送、工具权限、插话、中断、关闭后重开恢复等基本流程。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- PiSessionConfig 的实际 session 相关字段：
- 新建与恢复时 sessionId 的产生、持久化和返回时机：
- Harness event → Dogear event 映射：
- 权限 hook 实际行为与已知限制：
- session close/flush 的顺序：
- 下个 step 入口：
- 待办或已知限制：
