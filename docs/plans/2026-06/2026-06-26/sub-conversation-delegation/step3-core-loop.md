---
step: 3
title: 核心闭环（DelegateTo + SubmitDelivery + WaitForDeliveries）
status: pending
---

## 目标

把 bridge 接到 agent 工具体系，让主会话 agent 真的能自己派一个子会话、子会话真的能自己提交交付、主会话真的能 await 等齐。这是 Phase 2 的最小可用闭环。

## 依赖上下文（接力棒输入）

- Step 2 落了 bridge 全部方法（含 askParent/replyToChild 空实现）+ renderer events + 临时调试 IPC
- 工具注入入口在 `query-based-session.ts:355` 附近（`queryOptions.mcpServers = { ... }`），结合 `allowedTools` 控制可见性
- 现有工具注册模板：`electron/main/agents/tools/group-tools.ts`（createSdkMcpServer + registerTools）
- 子会话拉起时 `currentConversation.role === 'sub'` 是判定标志
- 设计文档「system prompt 增量」一节已给 sub system prompt 模板

## 计划改动

### 1. `electron/main/agents/tools/delegation-tools.ts`（新文件）
- `createDelegationTools(workspaceId, groupId, parentConversationId, settings)` 返回 SDK MCP server 名 `dogear-delegation`
- 本步只实现 3 个工具：
  - `DelegateTo` — Zod schema: `{ task: string, outputPath: string, title?: string }`
    - 调 `bridge.startChild({ parentConversationId, workspaceId, groupId, spec, settings, currentConversation: ... })`
    - currentConversation 怎么拿：要么 caller 注入，要么再加 conversationId 参数让工具 handler 自己 `conversationService.get()` 读
    - 推荐：createDelegationTools 接受 `getCurrentConversation: () => Promise<ConversationIndex>` 闭包，避免每次工具调用都重读
    - 返回 text content：`✅ 已派出子会话 {childId}（{title}）→ 交付路径 {outputPath}\n现在用 WaitForDeliveries([childId]) 等齐结果。`
    - 异常路径返回 isError + 原因（path conflict、模型未配置等）
  - `WaitForDeliveries` — schema: `{ childIds: string[], timeoutMs?: number }`
    - 调 `bridge.waitFor(parentConversationId, childIds, timeoutMs)`
    - 结果格式化为结构化 text：
      ```
      📦 交付汇总（共 N 个，{完成统计}）

      ✅ child_xxx（subtask1）→ subtask1.md
         summary: ...

      ⏱ child_yyy（subtask2）→ subtask2.md
         status: timeout
      ```
    - 返回时**不**带 raw JSON，让 agent 自己用 ReadGroupFile 读详情
    - 但 result 内含 outputPath 字符串，agent 能直接复制
- 注册元数据 `registerTools([...])`，category: 'delegation'

### 2. `electron/main/agents/tools/sub-agent-tools.ts`（新文件）
- `createSubAgentTools(workspaceId, groupId, childConversationId, outputPath)` 返回 MCP server 名 `dogear-sub-agent`
- 本步只实现 1 个工具：
  - `SubmitDelivery` — schema: `{ summary: string, outputPath: string }`
    - summary zod 限长：建议 `.min(1).max(2000)`（≤500 字 ~ 2000 字符兜底）
    - 调 `bridge.submitDelivery(childConversationId, summary, outputPath)`
    - bridge 内部校验 outputPath 一致 + 共享区有内容
    - 成功返回：`✅ 交付已提交`
    - 失败返回 isError + 原因（路径不一致 / 未先写共享区文件 / 子会话已 terminal）
- 注册元数据，category: 'delegation'

### 3. `electron/main/agents/query-based-session.ts`
- 在工具注入段（约 330-365 行）按 `conversation.role` 分流：
  - role='main'：加 `dogear-delegation`（接 Step 4-5 还会继续在同一 server 加更多工具，本步先 3 个工具中的 2 个 main 侧）
  - role='sub'：加 `dogear-sub-agent` + 在 mcpServers 里**移除** `dogear-delegation`（即使被注册过也滤掉，避免兜底误注入）
  - 同时维护 `allowedTools` 中 mcp 工具名一致性（参考现有 mcp__... 命名）
- 注入 createDelegationTools / createSubAgentTools 时把 `parentConversationId / childConversationId / outputPath` 等绑定参数传进去
- outputPath：子会话需要这个值——从哪里来？子会话 conversation 本身没存 outputPath 字段。两种方案：
  - **方案 A（推荐）**：bridge 暴露 `getOutputPathByChildId(childId): string | null`，子会话工具注入时调一次
  - 方案 B：在 conversation 元数据里加 `delegationOutputPath` 字段——污染数据模型，不推荐
- system prompt 增量：role='sub' 时拼装 sub system prompt（task/outputPath/契约），通过现有 `systemPrompt.append` 机制注入（参考设计文档"system prompt 增量"一节模板）
  - task 怎么拿：从 bridge.getChildSnapshot(childId).task — 但 ChildStateSnapshot 当前没有 task 字段！Step 1 类型定义需要补 `task: string`，Step 2 startChild 时写入。**这是 Step 1/2 的回填项**，在本步发现的话就回去补
  - 优先做法：本步直接给 ChildStateSnapshot 加 task 字段，Step 1/2 文档回填里记这个修正

### 4. `electron/main/tipc/agent.ts`
- 清理 Step 2 留的临时调试 IPC（除非 Step 4/5/6 还要复用，按需保留 startChild 调试入口到 Step 5 完）

### 5. 子会话权限模式
- 在子会话拉起时（bridge.startChild 内），把 `settings.subAgent.permissionMode ?? 'bypassPermissions'` 传给 QueryBasedSession 启动配置
- 这条不在工具注入路径上，是在拉起 worker 之前组装好 permissionMode 字段（覆盖 settings.ai.permissionMode）

## 验证

- `bun run build:electron` 通过
- `bun run lint` 通过
- 手测端到端：
  1. 启 app，建组，建主会话，让主会话用一个简单模型（Sonnet）
  2. 给主会话发消息：「派一个子会话给我写一段 hello world 的 Python 代码，交付到 hello.md」
  3. 观察：
     - 主会话调 DelegateTo → 工具返回 childId
     - conversations.json 出现新 sub conversation（role='sub'）
     - 列表里能看到这个 sub conversation（虽然 UI 未做缩进，至少能看到一行）
     - 主会话接着调 WaitForDeliveries
     - 子会话独立跑：自己读到 sub system prompt 知道要写 hello.md + 调 SubmitDelivery
     - 主会话 WaitForDeliveries 工具返回 → 主会话总结给用户
     - 共享区出现 hello.md
  4. 失败路径手测：
     - 子会话故意不调 SubmitDelivery（在 prompt 里说"写完文件但不要调 SubmitDelivery"）→ 看是否 no_delivery
     - timeout：DelegateTo 后 WaitForDeliveries 传 timeoutMs=10000，子会话故意 sleep → 看是否 timeout + 子会话被 abort
     - outputPath 冲突：让 agent 派两个子会话用同一路径 → 第二个 DelegateTo 应 isError

## 实施回填

### 实际改动

**与计划差异**：
- 子会话的 `task` / `outputPath` 不让子代理工具自查 bridge，而是把 `subAgent` 段加进 `QueryBasedSessionConfig`（仅 sub 时存在）；由 `buildConversationSessionConfig` 在 attach 阶段懒 import bridge 拿 snapshot 写入。好处：QueryBasedSession 内分流（MCP 注入 / sub system prompt）只看 `this.config.subAgent` 是否存在，零反向查询。
- `ChildStateSnapshot.task` 字段同步落到 `types/delegation.ts` 与 `electron/main/types.ts` 两处镜像。
- `bridge.startChild` 已先建 conversation → claim outputPath → attach；attach 时 `conversationService.getById` 已能读到 `role='sub'`，buildConversationSessionConfig 内 `bridge.getChildSnapshot(conversationId)` 能拿到（startChild 内 `childStates.set` 早于 attach）。**潜在坑**：若顺序倒置则 snapshot 为空 → subAgent 留空 → 子会话当普通会话跑。当前 bridge 实现 `childStates.set(childId, state)` 在 `attach` 之后才执行，这里得调整顺序。**需要回填检查**（见"已知坑"）。
- 子会话权限模式覆盖：复用 `session.setPermissionMode(...)`（与微信 bot 同款），从 `settings.subAgent.permissionMode ?? 'bypassPermissions'` 取。
- 调试 IPC `__debug_startChild / __debug_writeAndSubmit / __debug_waitFor` 已删除。

**改动文件清单**：
- `types/delegation.ts` L41-42：`ChildStateSnapshot.task` 新增
- `electron/main/types.ts` L246-247：主进程镜像同步
- `electron/main/agents/delegation-bridge.ts`：toSnapshot/buildResults/startChild 三处把 task 字段串起来
- `electron/main/agents/tools/delegation-tools.ts`（新建，112 行）：`createDelegationTools` + DelegateTo / WaitForDeliveries
- `electron/main/agents/tools/sub-agent-tools.ts`（新建，45 行）：`createSubAgentTools` + SubmitDelivery
- `electron/main/agents/query-based-session.ts`：
  - L86-87：import 两个工厂
  - L139-147：`QueryBasedSessionConfig.subAgent` 新增
  - L362-400：MCP 注入段重写，role 分流注入 dogear-delegation / dogear-sub-agent，sub 时强剔 dogear-delegation
  - L1625-1636：buildSystemPrompt 末尾追加 sub system prompt 段（任务 / 交付路径 / 4 条契约）
- `electron/main/services/conversation-runtime-service.ts`：
  - L133-135：allowedTools 放行 `mcp__dogear-delegation__*` 和 `mcp__dogear-sub-agent__*` 通配符
  - L158-172：sub 场景懒 import bridge 拉 snapshot 组装 subAgent
  - L194：return 对象追加 `subAgent`
  - L348-355：created 子会话设 permissionMode = `settings.subAgent.permissionMode ?? 'bypassPermissions'`
- `electron/main/tipc/agent.ts`：删除 L834-865 的三个调试 procedure

### 给下一步的接力棒

- **`createDelegationTools` 签名**：`(opts: { workspaceId; groupId; parentConversationId }) => SdkMcpServer`，server name `dogear-delegation`，工具 DelegateTo / WaitForDeliveries
- **`createSubAgentTools` 签名**：`(opts: { workspaceId; groupId; childConversationId; outputPath }) => SdkMcpServer`，server name `dogear-sub-agent`，工具 SubmitDelivery
- **工具注入的 mcpServers / allowedTools 控制方式**：
  - mcpServers 在 `query-based-session.ts` 内按 `this.config.subAgent` 存在性分流（main → delegation；sub → sub-agent）
  - allowedTools 在 `conversation-runtime-service.ts` 用通配符 `mcp__dogear-delegation__*` / `mcp__dogear-sub-agent__*` 同时放行；query-based-session 内做实际工具集裁剪。Step 4-5 新增的工具只要属于这两个 server 就自动放行
- **ChildStateSnapshot 实际加了 task 字段**：是；同步两处镜像
- **sub system prompt 拼装方式**：复用 `buildSystemPrompt` 现有 `append` 机制，在 `## 你是一个被派遣的子会话` 段拼接 task / outputPath / 4 条契约。preset 仍是 `claude_code`
- **子会话默认权限模式接入点**：`conversation-runtime-service.ts` 的 `attachConversation` 内，`created && role==='sub'` 分支调 `session.setPermissionMode(...)`
- **已知坑 / 待办**：
  - ✅ **顺序已修**：bridge.startChild 改为「先 set 占位 state（含 task/outputPath）→ 再 attach → attach 后 patch attachmentId/sessionId → wireSession → setTimeout → sendMessage」。占位时 attachmentId/sessionId 为空字符串，attach 失败会 delete state 回滚
  - allowedTools 通配符为 "声明可见集"，main 也会出现 `mcp__dogear-sub-agent__*` 通配符放行（但 query-based-session 实际不挂 sub-agent server，所以 SDK 看不到工具），无副作用
  - WaitForDeliveries 走 `bridge.waitFor`，timeout 默认从 settings 取；前端中断按钮（Step 7）将通过 `abortWaitsForParent` 介入
