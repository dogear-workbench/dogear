---
step: 3
title: 旧会话归档迁移与 runtime 收敛
status: done
---

## 目标

在 Step 2 已落地新 Conversation 的中立 sessionId 生命周期后，一次性冻结归档所有旧 SDK Conversation，并移除 SDK 主会话 runtime 分流，使主会话 runtime 只路由到 pi。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 2 已在新 Conversation schema 中落地 `sessionId: string | null`，PiSession 已通过 Harness repo create/open 持久化并在首次创建后回写稳定 sessionId。
- Conversation 主会话的 schema 与 runtime 已不再读取、写入或依赖 `sdkSessionId`；delegation 协议中的 `sdkSessionId` 命名和 SDK runtime 创建路径由 Step 5 统一迁移，本步骤不得扩大到 delegation。
- `conversation-runtime-service.ts` 的新 Conversation 已只走 PiSessionManager；需要审查并移除仅服务 SDK 主会话的 resume、close、release 与 delete 分支。
- 全局决策：迁移时现有全部 Conversation 都归档；旧 SDK JSONL 保留但不可回放、不可恢复、不可再参与摘要。
- 项目已有同类一次性迁移范式：`electron/main/services/memory/migration-p3.ts`、`migration-p4.ts` 与 `migration-gate.ts`（幂等 marker + 启动闸门，用于 digest/conversation-tree 历史迁移）；本步骤的 schema migration 应复用或对齐该范式，不另起一套 marker 机制。

## 计划改动

- [x] 增加带版本 marker 的可幂等一次性 schema migration（参照 `migration-p3.ts`/`migration-p4.ts` 的 marker + 闸门写法）；对存量 Conversation 统一设置 `archivedAt` 和 `archiveReason: 'sdk-main-session-removed'`，清除或忽略遗留 `sdkSessionId`。
- [x] 迁移必须沿用 Conversation service 的原子 JSON 写入机制并兼容已有数据；重复启动不得重置已有用户归档时间或破坏新 Conversation。
- [x] 将 migration 固定在 Conversation service 的唯一初始化入口：配置目录准备完成后、任何 Conversation 读写前执行；记录 marker、迁移数量和跳过原因。
- [x] 修改 conversation-runtime-service：删除 SDK 主会话分流和 resume 逻辑，所有非归档主会话只交由 PiSessionManager 管理；保留 `PARSE_ARTICLE` 对 SDK worker 的独立使用。
- [x] 调整会话 release/close 与对话删除前的数据读取，使不会再触发 SDK 主会话的 delete/resume API。
- [x] 执行 `bun run build:electron`，使用旧数据副本验证迁移幂等、旧会话归档、新会话首次发送后写入 sessionId。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：验收时发现规划缺口——`conversation-runtime-service.ts` 一旦强制走 PiSessionManager，会暴露 PiSession 从未接入股票/组协作/委派/复盘工具包的问题（Step 1-2D 遗留），临时插入 Step 2E（工具包 ToolDef 中立化）、Step 2F（PiSession 工具包接入 + 权限批量免确认）补齐后再合入本 step 的代码（改动本身在验收前就已写好，通过 `git stash` 暂存等 2E/2F 落地）。除此之外与计划一致。
- 改动文件清单：
  - `electron/main/services/conversation-service.ts`：新增 `ConversationIndex.archiveReason?: string`；新增幂等迁移 `runSdkMainSessionArchiveMigration()`（内部 `migrateSdkArchiveForWorkspace()`），marker 复用每个工作区 `conversations.json` 顶层 `version` 字段（`SDK_ARCHIVE_MIGRATION_VERSION = 3`），已归档的 Conversation 不重置 `archivedAt`，只清 `sdkSessionId`。
  - `electron/main/index.ts`：在 `migration-p3`/`migration-p4` 完成之后、`agentManager.start()`/`createWindow()` 之前调用 `runSdkMainSessionArchiveMigration()`（顺序原因：P3 依赖 `sdkSessionId` 匹配旧会话卡，需先跑完）。
  - `electron/main/services/conversation-runtime-service.ts`：整体重写（~250 行→~185 行），删除 `resolveApiFormat`/`buildConversationSessionConfig`/`wireConversationSession` 及全部 SDK 专属导入；`attachConversation()` 无条件走 `PiSessionManager`；`PARSE_ARTICLE` 独立 SDK worker 路径未受影响（已核实它不经过本服务）。
  - `electron/main/tipc/conversation-runtime.ts`：更新一处过期注释。
  - `electron/main/tipc/conversations.ts`：删除 `tryDeleteSdkSession()` 及其 SDK `deleteSession`/`getClaudeConfigDir`/`workspaceJsonService` 依赖，`deleteConversation` 不再调用 SDK delete API。

幂等性验证：用临时 workspace 数据（一条带 `sdkSessionId` 的旧会话、一条空会话、一条已手动归档的会话）跑了两次迁移函数——第 1 次归档 2 条、跳过已归档 1 条、三条 `sdkSessionId` 均清空；第 2 次完全 no-op，归档时间未被重置。构建：`bun run build:electron`/`bun run build`/`bun run lint` 均通过（lint 0 error，83 个不相关的历史 `any` warning）。

### 给下一步的接力棒

- Conversation 最终 schema 与 migration 标记：新增 `archiveReason?: string`（迁移固定写 `'sdk-main-session-removed'`，用户手动归档 `archiveConversation()` 不写此字段）；marker 是 `workspaces/<workspaceId>/conversations.json` 顶层 `version` 字段，`SDK_ARCHIVE_MIGRATION_VERSION = 3`。
- 归档旧会话的判定字段和 UI 可消费状态：`archivedAt` 有值即归档（不变）；`archiveReason` 用于区分"因移除 SDK 主会话冻结" vs "用户手动归档"；`toCompat()`/`ConversationCompat` **暂未**透出这个新字段给前端，UI 消费属于 Step 4。
- sessionId 写回的调用点与时序：已由 Step 2 完成；本 step 验证归档不会改写新 Conversation 的 sessionId（幂等测试第 2 次跑对新对话所在文件直接跳过，version 已达标）。
- 已删除或保留的 runtime 路由：删除"按 apiFormat 分流 SDK vs pi"整条路径及其 resume/fork/mcp/工具包组装逻辑；保留 `PARSE_ARTICLE` 独立 SDK worker 路径。
- 下个 step 入口：Step 4「历史、删除与 Fork 的 TIPC/UI 适配」——以 Conversation 为入口读取 Harness 历史、归档占位、删除、原生分叉。
- 待办或已知限制：
  1. **`delegation-bridge.ts` 的 `startChild()` 硬编码 `getQueryBasedSessionManager().getSession(attachment.sessionId)`**（约第 260 行），`attachConversation()` 现在无条件走 PiSessionManager，这里必定拿不到 session，`CreateSession`/`CreateSessionBatch` 会 100% 失败回滚。这不是"过渡期风险"而是本 step 落地后立即生效的真实断裂——Step 5（delegation 的 `sdkSessionId` 协议迁移）必须优先修复这个断点，建议 Step 5 排期时把它列为第一优先级，而不是留到该 step 末尾。
  2. `delegation-bridge.ts:231` 附近有一处过期注释提到已删除的 `buildConversationSessionConfig`，留给 Step 5 一并更新。
  3. `conversationService.updateSdkSessionId()` 及其 tipc procedure 是前端已无调用方的死代码（迁移前就已死掉），未删除，不在本次改动范围内。
  4. `.claude/rules/session-runtime.md` 里 `attachConversation()` 的示例签名（对象参数、`permissionMode` 可配置等）已经和当前实现（位置参数、`permissionMode` 固定回传 `'default'`）脱节，建议找机会跑一次 doc-sync 校准，不在本 step 范围内处理。
