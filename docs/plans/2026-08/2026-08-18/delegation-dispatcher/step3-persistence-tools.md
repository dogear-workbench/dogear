---
step: 3
title: 持久层 + 工具层——状态落盘 + ListLinkedSessions 合并 + ResumeSession
status: done
---

## 目标

childStates 快照落盘（重启不丢重试进度）；重启后 running 标记 interrupted；`ListLinkedSessions` 改「持久层为基础 + 内存实时覆盖」不再失忆；新增 `dogear__ResumeSession` 让主会话能调起中断的子会话。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-resume.md] resumeChild 已可用（本步 ResumeSession 工具直接复用）；ChildStateInternal 已有 retryCount/errorClass/modelTried
- 现状关键代码：
  - `electron/main/agents/delegation-bridge.ts`：childStates 内存 Map（重启全丢）；`getChildrenByParent` 只查内存
  - `electron/main/agents/tools/delegation-tools.ts`：`ListLinkedSessions`（main 分支）→ `bridge.getChildrenByParent`；`StopSession` 的契约校验模式（`contractMetadata.parentSessionId === ownSessionId`）——ResumeSession 照抄此模式
  - 持久层已有：conversation 记录含 `parentConversationId` + `contractMetadata`（task/expectedOutputPath/subAgentProfileId）——**关联关系磁盘上早就有，只是工具没读**
- 关键决策回顾：重启不自动续跑（主会话自身也断了，无人接收交付）；落盘走 withFileLock '#txn' 锁纪律（同 conversations.json 事务模式）

## 计划改动

- [x] `electron/main/agents/delegation-bridge.ts` 新增持久化 section（纯读写拆到 `delegation-persist.ts`）：
  - [x] `DELEGATION_STATE_FILE = 'delegation-state.json'`（getConfigDir() 下，全局单文件，不分 workspace——childStates 本就跨 workspace）
  - [x] `persistDelegationState()`：全量写 `{ version: 1, children: PersistedChildState[] }`；内部 `withFileLock(path + '#txn', 锁内组数据→safeJsonWrite)`
  - [x] 写入时机：`touchPersist(childId)` helper 统一挂在 startChild 成功后、settleTerminal 终态分支、markChildDelivered、resumeChild 后
  - [x] `loadChildStates()`（挂载在 `electron/main/index.ts` scheduler init 后 fire-and-forget）：读文件 → conversation 不存在的过滤 → running → interrupted（errorMessage '应用重启中断'）→ 清空内存后灌回（attachmentId 清空）→ 回写磁盘
- [x] `getChildrenByParent(parentConversationId)` 改造为合并数据源：
  - [x] 内存 childStates 为主，去重键 childId 内存优先
  - [x] 持久层补集：新增 `conversationService.listByParent(workspaceId, parentConversationId)`（只读无事务）；workspaceId 从内存条目或 `getByIdGlobal(parent)` 取
  - [x] 持久层条目 `conversationToSnapshot`：task/outputPath 从 contractMetadata 补，profileName 从 subAgentProfileId 反查 settings（miss 用「默认」），status 恒 interrupted
- [x] `electron/main/agents/tools/delegation-tools.ts`：
  - [x] `dogear__ResumeSession({ sessionId })`：StopSession 同款校验（存在性 + `contractMetadata.parentSessionId === ownSessionId`）→ childId 反查（内存 `getChildIdBySessionId`，miss 时 `getBySessionId` 取 conv.id）→ `snapshot.status !== 'running'` 才调起 → `bridge.resumeChild(childId, { reason: '主会话调起' })` → 返回「已调起，它将检查进度后继续」
  - [x] 注册走文件末尾既有 registerToolGroup（defineTool 即自动覆盖）
- [x] `electron/main/agents/session-append-templates.ts`：主会话协作规范段补 ResumeSession 使用指引

## 验收路径

1. [x] `bun run build:electron` 通过；`bun run lint` 0 errors
2. [x] script 级：`delegation-persist.test.ts` 4 个用例全过（落盘字段完整 / running→interrupted / 已删 conversation 过滤 / 持久层补集合并去重）
3. [ ] dev 环境端到端（主会话安排，不在本步范围）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 纯读写拆出 `delegation-persist.ts`（PersistedChildState / persistDelegationState / loadRestorableChildren / conversationToSnapshot），bridge 839 行只挂 touchPersist 调用点与恢复编排
  - 持久层补集 status 用 'interrupted' 而非 'unknown'（避免扩 ChildStatus 类型波及前端镜像）
  - loadChildStates 先 `childStates.clear()` 再灌回（磁盘为重启后权威来源；生产启动时内存本为空，语义更精确）
  - markChildDelivered（done 终态）也挂 touchPersist，补齐计划 4 点之外的真实终态变更点
  - 测试基建：共享 mock 增加 DOGEAR_CONFIG_DIR 隔离（mkdtemp）、conversation-service mock 补 create options/getByIdGlobal/getBySessionId/listByParent
- 改动文件清单：见 step3-delivery.md（共享区）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `resumeChild(childId, { reason, modelOverride? })` 已 export（delegation-bridge.ts）
  - `loadChildStates()` 已挂 index.ts 启动序列；`PersistedChildState = ChildStateSnapshot & { workspaceId }`
  - `getChildrenByParent` 已改 async，两个调用方（delegation-tools / tipc/delegation.ts）均已 await
- 下个 step 该从哪里继续：
  - 交付链路验收（重启 → ResumeSession → 交付）在 dev 环境端到端走
- 待办或已知限制：
  - 持久层补集条目无 retryCount/modelTried（重启前状态只存在状态文件里，conversation 无此信息）
  - 既有失败：categorize-prompt.test.ts 2 例（与本次无关，HEAD 上即失败）
