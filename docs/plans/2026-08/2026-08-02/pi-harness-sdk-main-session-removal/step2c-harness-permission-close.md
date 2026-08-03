---
step: 2c
title: Harness 权限与关闭语义
status: pending
---

## 目标

将 PiSession 的完整权限状态机迁移至 Harness tool_call hook，并完成 abort、close、release 的权限清理和持久化顺序。

## 依赖上下文（接力棒输入）

- Step 2B 已通过 adapter 让 PiSession 使用 AgentHarness，且消息、队列、状态和 usage 已可用。
- 现有 PiSession 保留 dontAsk、豁免规则、会话 allow、持久 allow、前端响应和 pending permission Map。
- Harness `tool_call` hook 返回 `{ block?: boolean; reason?: string }`，事件含 toolName 和可展示的 input。
- 不允许以默认放行或移除工具确认来规避适配难度。

## 计划改动

- [ ] 将工具执行前的权限判断迁入 adapter/PiSession 的 tool_call 注册点，保留现有 `permissionRequest` 事件与 respondPermissionRequest 方法签名。
- [ ] 确保 dontAsk、豁免规则、session allow、persistent allow、allow、deny 的语义与现有 PiSession 一致。
- [ ] 对“编辑工具输入后允许”做实际验证；仅当 Harness 执行器读取同一 input 引用时才可原地改写，否则使用上游正式支持的显式改写机制。
- [ ] 将 interrupt、close、PiSessionManager release 的处理收敛为：清队列、abort、拒绝 pending permission、等待/确认已完成写入后释放；避免死锁和未处理 rejection。
- [ ] 执行 `bun run build:electron`，手动验证工具允许、拒绝、always allow、编辑后允许、中断、关闭重开恢复。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- tool_call hook 的权限接口和返回语义：
- 编辑输入验证结果：
- abort/close/release 落盘顺序：
- 已知限制：
- 下个 step 入口：Step 2D 进行端到端人工回归、构建和仅针对真实事件顺序问题的修正。
