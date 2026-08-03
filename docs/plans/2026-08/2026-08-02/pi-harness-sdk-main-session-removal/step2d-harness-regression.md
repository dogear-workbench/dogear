---
step: 2d
title: Harness 主会话回归验收
status: pending
---

## 目标

完成 Harness 主会话迁移的端到端构建与人工回归，并仅修正实际发现的事件时序问题。

## 依赖上下文（接力棒输入）

- Step 2A 至 Step 2C 已完成 Conversation 生命周期、Harness adapter、消息/状态/usage 和权限/关闭语义。
- Step 3 的前提是新 Conversation 已稳定使用 Harness sessionId；本步不归档旧 Conversation，不删除 SDK runtime 分支。
- 人工流程必须使用 Pi 模型配置，避免误走 SDK runtime。

## 计划改动

- [ ] 执行 `bun run lint` 与 `bun run build:electron`，修正本步骤范围内的类型或 lint 问题。
- [ ] 人工验证新建并发送、退出后重开恢复、工具确认与编辑/拒绝/记忆授权、连续插话、中断、关闭后重开、usage 与前端 running 状态。
- [ ] 仅针对回归发现的 Harness 事件顺序、持久化或状态问题做最小修正；不得提前实施 Step 3 的归档或 SDK runtime 清理。
- [ ] 记录已验证流程、未覆盖条件和已知限制，作为 Step 3 接力棒。

## 实施回填（做完后填）

### 实际改动

- 验证结果：
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 已验证的新 Conversation 生命周期：
- 已验证的权限/插话/关闭语义：
- 未覆盖或已知限制：
- 下个 step 入口：Step 3 仅执行旧 Conversation 一次性归档、SDK 主会话 runtime 残余分支收敛和迁移幂等性。
