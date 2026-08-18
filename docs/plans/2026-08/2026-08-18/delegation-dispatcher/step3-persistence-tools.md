---
step: 3
title: 持久层 + 工具层——状态落盘 + ListLinkedSessions 合并 + ResumeSession
status: pending
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

- [ ] `electron/main/agents/delegation-bridge.ts` 新增持久化 section：
  - [ ] `DELEGATION_STATE_FILE = 'delegation-state.json'`（getConfigDir() 下，全局单文件，不分 workspace——childStates 本就跨 workspace）
  - [ ] `persistChildStates()`：全量写 `{ version: 1, children: ChildStateSnapshot[] }`；内部 `withFileLock(path + '#txn', 读→覆盖写)`——注意直接用 safeJsonWrite 前先在锁内组好完整数据（写是全量覆盖，无读改写竞争面，但仍过 txn 锁保持纪律一致）
  - [ ] 写入时机：startChild 成功后、onSessionComplete 终态后、stopChild 后、resumeChild 后（状态变更点统一在一个 `touchPersist(childId)` helper 里，避免漏）
  - [ ] `loadChildStates()`（应用启动时调用一次，挂载点在 `electron/main/index.ts` 现有初始化序列，找 scheduler/delegation 现有 init 位置跟随）：读文件 → 过滤 conversation 已不存在的条目（`conversationService.getById`）→ status === 'running' 的改 'interrupted'（errorMessage '应用重启中断'）→ 灌回 childStates（attachmentId 清空）
- [ ] `electron/main/agents/delegation-bridge.ts`：`getChildrenByParent(parentConversationId)` 改造为合并数据源：
  - 内存 childStates 为主
  - 持久层补集：`conversationService` 按 workspace 查 `role === 'sub' && parentConversationId === 匹配` 的 conversation（需要新增查询函数 `listByParent(workspaceId, parentConversationId)`——走 conversation-service，只读不写无需事务；workspaceId 从 parent conversation 记录取）
  - 持久层条目转 snapshot 形状：task/outputPath 从 contractMetadata 补，profileName 从 subAgentProfileId 反查 settings，status 用 'unknown' 或内存值
  - 去重键 childId，内存优先
- [ ] `electron/main/agents/tools/delegation-tools.ts`：
  - [ ] `dogear__ResumeSession({ sessionId })`：StopSession 的校验模式（存在性 + `contractMetadata.parentSessionId === ownSessionId`）→ childId 反查（内存 `getChildIdBySessionId`，miss 时 `conversationService.getBySessionId` 取 conv.id）→ `snapshot.status !== 'running'` 才可调起 → `bridge.resumeChild(childId, { reason: '主会话调起' })` → 返回「已调起，它将检查进度后继续」
  - [ ] 工具注册元数据（文件末尾 registerToolGroup 自动覆盖——defineTool 即可）
- [ ] `electron/main/agents/session-append-templates.ts`：主会话协作规范段补一句 ResumeSession 的使用指引（「重启或中断后，用 dogear__ResumeSession 调起之前的子会话继续，而不是重新 CreateSession」）

## 验收路径

1. `bun run build:electron` 通过
2. script 级：`delegation-persist.test.ts`——startChild 后文件存在且字段完整；load 时 running → interrupted 转换；conversation 已删的条目被过滤
3. dev 环境端到端（核心验收）：
   - 主会话派子会话（长任务）→ 等任务跑一半时**重启应用** → 子会话标记 interrupted，`dogear__ListLinkedSessions` 仍能看到它（含 task/outputPath/状态）
   - 主会话说「继续」→ LLM 调 `dogear__ResumeSession` → 子会话复活，收到的继续提示让它接着干（消息历史完整，agent 知道做到哪了）
   - 交付链路完整：复活后完成 → SendMessage(delivery) → 主会话 WaitForMessage 收到

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
