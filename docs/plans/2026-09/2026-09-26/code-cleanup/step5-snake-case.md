---
step: 5
title: snake_case 双格式迁移
status: done
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

## 实施回填（2026-09-26 完成）

- 改动 23 代码文件净 -118 行：conversation-service 删 ConversationCompat+toCompat；tipc/conversations ×3、tipc/group ×1 去转换；workspace-json-service 三接口合一为 camelCase Workspace（删 toWorkspace/toWorkspaceData）；tipc/workspace 同步；types/electron-api Conversation 改 ConversationIndex 镜像（删 model 与 fork_pending 零消费字段）；前端 16 文件消费点全切
- 前置实锤：磁盘 workspaces.json 与 conversations.json 均已 camelCase，转换层删除安全
- 行为等价性：时间字段 number→ISO string，所有比较点显式 new Date(...).getTime()；sessionId undefined→null、groupId/role 改 optional，消费点均 falsy/?? 判断不变；is_default 0|1→isDefault boolean 真值判断不变
- grep 复验：六字段（+additional_paths/is_default）在 app/components/stores/lib/hooks/types 下仅剩 agent-chat/utils.ts:139-140 的 sender 标签协议字面量（数据格式保留）；主进程残留均为合法用途（sender 生成端/cookie 名单/函数名误中）
- 验证：lint 0 errors、双侧 tsc 通过（tipc 类型直推兑底）、bun test 319 pass/0 fail/1 skip（=基线）、dev 启动冒烟无本次相关报错
- 遗留：GUI 六项交互冒烟待用户日常留意首屏；相邻未动项：ConversationList.tsx 类型再导出（二.8 纯整洁）、主进程 forkPending/archivedAt @deprecated 字段
