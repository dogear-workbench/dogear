---
step: 5
title: snake_case 双格式迁移
status: pending
---

## 目标
前端全量切 camelCase，删除主进程 IPC 出口的 toCompat 转换层与 snake_case 兼容类型。

## 依赖上下文（接力棒输入）
- 调研报告：共享区 `20260926-compat-code-report.md` 二.2/二.3
- 现状：磁盘数据与主进程内部已是 camelCase；`conversation-service.ts:73` ConversationCompat 类型 + `:643-673` toCompat 仅在 IPC 出口转换；消费方 `tipc/conversations.ts:21,82,197`、`tipc/group.ts:112`
- 实测前端消费点：12 文件 32 处（app/data-center/usage-panel、agent-chat/AgentCommCard、agent-chat/utils、archive/ArchiveTopicList、companion/TerminalPanel、conversation-list/ConversationRow、conversation-list/PersonalSection、conversation-list/utils、notes/TaskPanel、stores/conversation-store、lib/conversation-sort、lib/reference-guard）
- 涉及字段：session_id / workspace_id / created_at / updated_at / parent_conversation_id / fork_pending

## 计划改动

- [ ] `types/electron-api.ts:154` Conversation 类型改 camelCase 字段；删 `:163` 已 @deprecated 的 fork_pending（SDK 时代遗留，先全库 grep fork_pending 确认无消费）
- [ ] 前端 12 文件：所有 snake_case 字段访问点改 camelCase（`bunx tsc --noEmit` 逐文件收敛，编译器兜底找漏改点）
- [ ] `tipc/conversations.ts` / `tipc/group.ts`：去掉 toCompat 调用，直接返回主进程对象
- [ ] `conversation-service.ts`：删 ConversationCompat 类型(:73) 与 toCompat(:643-673)
- [ ] **workspace 兼容格式同场迁移**（报告二.3）：`workspace-json-service.ts:41-47,100-118` 内部↔兼容双格式转换删除；前端 3 处 `ws.is_default`（AbilityTab:254、WorkspaceManagementTab:254、WorkspaceSwitcherPopover:165）改 `isDefault`，created_at 同理
- [ ] grep 复验：`session_id|workspace_id|created_at|updated_at|parent_conversation_id|fork_pending` 在 app/components/stores/lib/hooks 下零命中（排除字符串字面量用途——注意 usage JSONL 历史数据解析处的 snake_case 是**数据格式**不是代码格式，保留）

## 收尾验证
- [ ] lint + 双侧 tsc + bun test
- [ ] 启动冒烟：会话列表加载、新建会话、归档视图、个人会话区、用量面板、任务面板全部正常显示（这些是转换层消费方）
