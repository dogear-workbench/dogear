---
step: 2c
title: Harness 权限与关闭语义
status: pending
---

## 目标

完成 Harness 下 abort、close、release 的权限清理与持久化顺序，并回归已在 Step 2B 接入的权限状态机。

## 依赖上下文（接力棒输入）

- Step 2B 已通过 adapter 让 PiSession 使用 AgentHarness，并已将完整权限状态机接入 `tool_call` hook。
- PiSession 保留 dontAsk、豁免规则、会话 allow、持久 allow、前端响应和 pending permission Map。
- Harness `settled` 与 `save_point` 已可作为关闭前写入完成的同步边界。
- 不允许以默认放行、移除工具确认或跳过权限回归来规避适配难度。

## 计划改动

- [ ] 回归确认 adapter/PiSession 的 `tool_call` 权限接口、`permissionRequest` 事件与 `respondPermissionRequest` 方法签名保持完整语义。
- [ ] 回归确认 dontAsk、豁免规则、session allow、persistent allow、allow、deny 与编辑工具输入后的执行结果。
- [ ] 将 interrupt、close、PiSessionManager release 的处理收敛为：清队列、abort、拒绝 pending permission、等待/确认 `settled` 与 `save_point` 已完成写入后释放；避免死锁和未处理 rejection。
- [ ] 执行 `bun run build:electron`，手动验证工具允许、拒绝、always allow、编辑后允许、中断、关闭重开恢复。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- Step 2B 的 tool_call hook 权限接口和返回语义回归结果：
- Step 2B 的编辑输入验证结果回归：
- abort/close/release 落盘顺序：
- 已知限制：
- 下个 step 入口：Step 2D 进行端到端人工回归、构建和仅针对真实事件顺序问题的修正。
