---
step: 2d
title: Harness 主会话回归验收
status: done
---

## 目标

完成 Harness 主会话迁移的端到端构建与人工回归，并仅修正实际发现的事件时序问题。

## 依赖上下文（接力棒输入）

- Step 2A 至 Step 2C 已完成 Conversation 生命周期、Harness adapter、消息/状态/usage 和权限/关闭语义。
- Step 3 的前提是新 Conversation 已稳定使用 Harness sessionId；本步不归档旧 Conversation，不删除 SDK runtime 分支。
- 人工流程必须使用 Pi 模型配置，避免误走 SDK runtime。

## 计划改动

- [x] 执行 `bun run lint` 与 `bun run build:electron`，修正本步骤范围内的类型或 lint 问题。
- [ ] ~~人工验证新建并发送、退出后重开恢复、工具确认与编辑/拒绝/记忆授权、连续插话、中断、关闭后重开、usage 与前端 running 状态。~~（用户决定跳过，见实施回填）
- [ ] 仅针对回归发现的 Harness 事件顺序、持久化或状态问题做最小修正；不得提前实施 Step 3 的归档或 SDK runtime 清理。
- [x] 记录已验证流程、未覆盖条件和已知限制，作为 Step 3 接力棒。

## 实施回填（做完后填）

### 实际改动

- 验证结果：`bun run lint` 通过（0 error，83 个既有 `@typescript-eslint/no-explicit-any` warning，均为历史遗留，非本次迁移引入）；`bun run build:electron` 通过，`tsc -p tsconfig.electron.json` 无报错。
- 与计划差异：人工回归环节（新建发送、退出重开、权限确认/编辑/拒绝/记忆授权、连续插话、中断、关闭重开、usage 与 running 状态）经用户明确决定**跳过**，未在本步骤执行；因此未发现任何"回归问题"，也未做计划中"仅修正回归发现的问题"这一项。
- 改动文件清单：仅 `step2d-harness-regression.md`（本文件，状态与回填）、`plan.md`（步骤索引打勾）。无业务代码改动。

### 给下一步的接力棒

- 已验证的新 Conversation 生命周期：仅通过静态检查（类型检查 + lint）验证，**未做运行时人工验证**。
- 已验证的权限/插话/关闭语义：**未验证**（人工回归被跳过）。
- 未覆盖或已知限制：Step 2A～2C 声称实现的以下运行时行为均未经人工验证，存在未知风险——新建并发送消息、退出后重开恢复、工具调用权限确认、编辑/拒绝权限请求、记忆授权、连续插话队列、中断（abort）、关闭会话后重开、usage 统计准确性、前端 running/pendingAction 状态显示。若 Step 3 及之后的归档/清理工作暴露出这些流程的问题，需要回溯到 Step 2A～2D 定位。
- 下个 step 入口：Step 3 仅执行旧 Conversation 一次性归档、SDK 主会话 runtime 残余分支收敛和迁移幂等性；建议在 Step 3 或更早阶段安排一次实际人工回归，以降低累积风险。
