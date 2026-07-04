---
step: 4
title: 子会话工具集 reference-tools
status: done
---

## 目标

新增子会话专用的 MCP 工具：`ReadReferenceSession` / `ReadGroupBackground` / `ListSiblingSessions`。装配到 delegation 子会话的可用工具集里。主 agent 派子会话时，子会话就能用这套工具组合读组卡/背景/兄弟原文/单个会话原文。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - Step 2 完成 `readCleanTranscript(sessionId, options)` 纯函数（本 step 直接调）
  - Step 3 完成 background-store.ts 的 readGroupBackground / GroupBackground 类型（本 step 直接调）
  - Step 1 完成组卡新路径迁移（ReadGroupDigest 已经指向新路径）
- 关键决策回顾：
  - 这套工具**只装到子会话**，不给主 agent（主 agent 只有 DelegateTo）
  - `ReadReferenceSession` 是通用工具，跟组无关，用来读任意 sessionId 的清洗后原文
  - `ReadGroupBackground` / `ListSiblingSessions` 是组相关工具，非组内子会话调用时应返回空/明确 no-op
  - 子会话怎么知道自己在哪个组：由父会话的 DelegateTo 任务 payload 传 groupId + workspaceId
- delegation 现状：
  - `delegation-tools.ts` 已有 DelegateTo / SubmitDelivery
  - 子会话的工具集在 delegation 子会话启动流程里装配（需要 grep 确认具体位置）

## 计划改动

### 新增文件

- [ ] `electron/main/agents/tools/reference-tools.ts`
  - 归属 server：新建 `dogear-reference` MCP server
  - 工具 1：`ReadReferenceSession`
    - 入参：`{ sessionId: string, tail?: number, range?: [number, number] }`
    - 内部：调 `readCleanTranscript(sessionId, options)`
    - 返回：`{ ok, text, totalCount }` 或 `{ ok: false, error }`
  - 工具 2：`ReadGroupBackground`
    - 入参：`{ groupId: string }` （workspaceId 从子会话 context 拿）
    - 内部：调 `background-store.readGroupBackground(wsId, groupId)`
    - 返回：GroupBackground 对象 或 `null` + 明确 message "background.md 尚未生成，可依赖 ReadGroupDigest + ListSiblingSessions"
  - 工具 3：`ListSiblingSessions`
    - 入参：`{ groupId: string }`
    - 内部：调 conversation-service 拿组内所有 conversations，映射成 `{ sessionId, title, lastActivity, isActive, hasDigestCoverage }`
    - `isActive`：SDK JSONL 的 mtime 距今 < 5 分钟
    - `hasDigestCoverage`：该 sessionId 是否出现在组卡的 sourcesSeen[] 里
    - **过滤当前子会话的父会话 sessionId 本身**（子会话 context 里有父 sessionId，通过它识别）
    - 排除 `role='sub'` 的子会话记录

### 修改文件

- [ ] `electron/main/services/conversation-service.ts`
  - 提供 `listConversationsInGroup(wsId, groupId): Promise<Conversation[]>`（如果没有的话）
  - 用于 ListSiblingSessions 拿组内会话
- [ ] delegation 子会话工具装配点（grep `DelegateTo` 或 `delegation-tools.ts` 找到）
  - 新的 dogear-reference server 加进子会话可用的 mcpServers 列表
  - 保留子会话已有的 SubmitDelivery 等
- [ ] delegation payload / context：
  - DelegateTo 调用时，把父会话的 groupId + workspaceId 传给子会话，供子会话工具用
  - 具体做法看 delegation-tools.ts 现有 payload 结构，可能需要在 subAgent 启动时读父会话的 conversation 元数据自动注入
- [ ] `agent-worker.ts` 或 tool-registry：
  - 注册 reference-tools 到子会话可见的工具池

### 类型层

- [ ] `types/` 或 shared：`SiblingSession` / `GroupBackgroundToolResult` 等类型定义
- [ ] `electron/main/types.ts` 镜像

### 潜在踩雷

- 子会话如何拿到 workspaceId：可能需要 delegation 启动时按父会话的 conversationId 反查 workspaceId 注入
- `isActive` 判定的 mtime 读取：注意读 SDK JSONL 的 mtime 需要跨平台（Windows/mac fs.stat 语义一致，应该 ok）
- ListSiblingSessions 排除子会话记录：目前 `role` 字段在哪里存的（conversation 元数据？sdk session 元数据？）需要查一下

## 手测清单

- [ ] 在 debug 页或组内新建一个会话，让主 agent 派子会话
- [ ] 观察子会话工具池里能看到 ReadReferenceSession / ReadGroupBackground / ListSiblingSessions
- [ ] 子会话调 ListSiblingSessions 应返回组内**其他**会话（不含自己那个父会话）
- [ ] 子会话调 ReadGroupBackground(groupId)：
  - 组已有 background.md → 返回结构化字段
  - 组还没 background.md → 返回 null + 明确 message
- [ ] 子会话调 ReadReferenceSession(sessionId)：
  - 有效 sessionId → 返回去噪后原文
  - 无效 sessionId → 返回 `ok: false` 而不是 throw
- [ ] 子会话调 ReadReferenceSession(sessionId, { tail: 20 })：返回后 20 条去噪消息
- [ ] 非组内会话派的子会话：ReadGroupBackground / ListSiblingSessions 返回 empty/no-op；ReadReferenceSession 仍能用

## 实施回填

### 实际改动

**新增文件 `electron/main/agents/tools/reference-tools.ts`**：
- server 名 `dogear-reference`
- `createReferenceTools(opts: { workspaceId, workspacePath, groupId, parentConversationId })` — 三关键上下文都从 closure 注入，agent 侧几乎无需入参
- 三个工具：
  - `ReadReferenceSession({ sessionId, tail?, range? })` — 内部调 `readCleanTranscript(workspacePath, sessionId, options)`；返回 `sessionId=X count=N totalCount=M lastTimestamp=... \n\n<transcript>`
  - `ReadGroupBackground({})` — 用 closure 里的 groupId 调 `readGroupBackground(wsId, groupId)`；null 时返回明确 message 引导 agent 退回组卡 + 兄弟列表
  - `ListSiblingSessions({})` — 用 closure 里的 groupId + parentConversationId；`getByWorkspaceId(wsId).filter(c => c.groupId === groupId && c.role !== 'sub' && c.id !== parentConversationId && !!c.sdkSessionId)`；每条给 `sessionId / title / lastActivity / isActive / hasDigestCoverage`；`isActive = mtime > 0 && now - mtime < 5min`；`hasDigestCoverage = sourcesSeen.includes(sessionId)`
- `registerTools` 注册三个元数据（category=memory，供设置页动态展示）

**修改 `query-based-session.ts` (:369-390)**：
- import `createReferenceTools`
- 在 `isSubAgent` 分支里 sub-agent tools 旁边加一行装 `dogear-reference` server
- 传入 `subAgent!.parentConversationId` 作为排除父会话本身的依据

**修改 `conversation-runtime-service.ts` (:131-136)**：
- 在 groupId 分支下 push `mcp__dogear-reference__*`（与 delegation/sub-agent 对称，避免子会话调工具弹权限）

**未修改的地方**：
- **DelegateTo payload 未加 groupId/workspaceId 字段** — 报告确认走 Path A：子会话通过 `conversation.role='sub' + groupId + parentConversationId` 三字段自动携带，QueryBasedSessionConfig 已经把 workspaceId/workspacePath/groupId/subAgent.parentConversationId 都搬到装配点，无需 payload 显式传
- **`conversation-service.ts` 未新增 `listConversationsInGroup`** — 直接在 ListSiblingSessions 里用现成 `getByWorkspaceId + filter`，两行代码不值得单独抽 helper
- **types.ts 未加 `SiblingSession` / `GroupBackgroundToolResult` 镜像** — 工具返回值是 text 字符串（agent-facing），不跨 IPC 前端不需要类型

### 与原 plan 差异

- Agent 无需在工具入参里传 groupId/workspaceId，全部走 closure（简化 agent 决策）
- allowedTools 对称放行了 `mcp__dogear-reference__*`，虽然子会话通常有 bypassPermissions 但保险起见照对齐 delegation/sub-agent 模式
- ListSiblingSessions 未去查 `role` 字段的存储位置（原 plan 提示"要查一下"）——实测就在 `ConversationIndex.role` 字段，直接 `c.role !== 'sub'` 即可
- ReadGroupBackground / ListSiblingSessions 都是零参数（原 plan 期望 `{ groupId }`）——因为 groupId 从 closure 拿，agent 不用记

### 手测

未跑手测：
- `bun run build:electron`：**通过**
- Step 5 端到端时验证：主 agent（组内非首个）派子会话 → 子会话工具池含 dogear-reference 三个工具 → 各工具能正确返回

### 给下一步（Step 5）的接力棒

**关键状态**：
- 子会话已能读组背景 / 兄弟列表 / 任意历史会话原文
- 主 agent 目前**没有**任何 dogear-reference 工具，只有 dogear-delegation
- Step 5 需要写 systemPrompt append 文案，引导主 agent 在需要「组背景 / 兄弟进展 / 引用历史会话」时**主动 DelegateTo 子会话**，并告知子会话可用工具（ReadGroupBackground / ReadGroupDigest / ListSiblingSessions / ReadReferenceSession）——这些工具名要与 reference-tools.ts + group-digest-tools.ts 保持一致
- 文案位置：`session-append-templates.ts`（新增）或直接常量写在 `conversation-service.ts` create/createFork 附近，Step 5 决定

**注意**：
- 主 agent 不知道 dogear-reference 三个工具的存在（它没这些工具）——systemPrompt B 段可以直接列出这些工具名给主 agent 看，主 agent 用自然语言告诉子会话「你有 ReadGroupBackground / ListSiblingSessions / ReadReferenceSession」时，子会话会真的看到这些工具（因为 sub-agent 侧装了）
- 子会话是不是"新会话"和它是不是"在组里"是不同概念——子会话总是 role='sub'，且总是有 groupId（继承父的）。反之组内主会话（role='main'）不装 reference-tools，需要通过 DelegateTo → sub 才能用
