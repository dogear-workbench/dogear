---
step: 6
title: 移除 SDK 主会话代码并验收边界
status: pending
---

## 目标

删除 Claude Agent SDK 的主会话依赖和遗留接口，确认其仅保留于 PARSE_ARTICLE 后台任务，并完成迁移后的构建与关键流程验收。

## 依赖上下文（接力棒输入）

- 前置 step 产出：主会话创建、恢复、历史、删除、fork、摘要、引用和 delegation 都已使用 Harness sessionId；旧 Conversation 已冻结归档。
- `@anthropic-ai/claude-agent-sdk` 仍是必要依赖，因为 `PARSE_ARTICLE` 继续走 SDK query 与 plugin/skill 发现。
- 清理目标仅为“SDK 主会话路径”，不得误删 PARSE_ARTICLE、其 worker payload、query 配置或文章解析 skill 所需代码。

## 计划改动

- [ ] 全局检索 `QueryBasedSession`、QueryBasedSessionManager、SDK 主会话 resume/fork/history/permission/usage 代码及 `sdkSessionId` 残留；逐项区分 PARSE_ARTICLE 必需项和应删除项。
- [ ] 删除 SDK 主会话类、manager、主会话专属 TIPC procedures、renderer 事件桥接与无调用方的工具/配置适配代码。
- [ ] 收敛 `agent-query-config.ts` 或拆出 PARSE_ARTICLE 专用配置，避免其继续暴露主会话语义。
- [ ] 清理 conversation runtime、conversation CRUD、类型定义、日志和 UI 中的 SDK 主会话术语；保留旧归档 metadata 的 archiveReason 兼容，不恢复 sdkSessionId。
- [ ] 更新开发文档、代码地图和相关计划/设计引用，明确“两类运行时”已变为“主会话 Harness + PARSE_ARTICLE SDK worker”。
- [ ] 执行 `bun run lint`、`bun run build:electron` 和 `bun run build`，修复所有类型/死代码/构建问题，不以跳过检查或 suppress 方式绕过。
- [ ] 手动回归：新建并恢复 pi 主会话、工具权限、插话与中断、历史、fork、归档旧会话占位、组摘要、delegation、文章解析 PARSE_ARTICLE。
- [ ] 确认 npm/Bun 依赖中 SDK 仍存在且仅由 PARSE_ARTICLE 链路引用；记录最终残留入口和未来移除前置条件。
- [ ] 完成后回填计划索引与完成总结，并按 doc-sync 要求同步代码地图。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 完成后无需下一步；在此记录：
- SDK 最终保留文件及 PARSE_ARTICLE 调用链：
- 已验证流程与构建命令结果：
- 与原计划的差异、已知限制与后续候选：
