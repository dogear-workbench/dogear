---
step: 1
title: PiSession 角色感知与真实 sessionId 暴露
status: done
---

## 目标

修复 `PiSession` 里两处硬编码：`start()` 组装 `dogear-delegation` 工具包时角色恒为 `'main'`（导致子会话拿到主会话专属工具集）；`getSdkSessionId()` 恒返回 `undefined`（导致上游拿不到真实 Harness sessionId）。

## 依赖上下文（接力棒输入）

- 当前关键文件状态：`electron/main/agents/pi-session/pi-session.ts`
  - `PiSessionConfig`（第 53-69 行）目前没有 `role` 字段。
  - `start()` 第 248-258 行：`if (this.config.groupId) { ... createDelegationToolDefs({ role: 'main', workspaceId, groupId, conversationId }) ... }`——注释（第 248-250 行）明确写着"本 step 只服务主会话，role 固定 'main'；子会话的 pi 化工具包接入留给 Step 5"，现在就是那个"以后"。
  - `getSdkSessionId()`（第 151-154 行）：`return undefined;`，注释是过时的"pi 阶段一没有 SDK 式持久化 session_id"说法。
  - `this.config.harnessSessionId` 在 `start()` 内（第 164-172 行）会被同步赋值：要么 `repository.open()` 恢复已有 session（此时 `this.config.harnessSessionId` 在调用 start() 前就已经有值），要么 `repository.create()` 新建后立刻 `this.config.harnessSessionId = info.id`。**关键结论：无论哪条分支，`start()` 的 Promise resolve 时 `this.config.harnessSessionId` 一定已经有值**——不存在需要等待异步事件的时序问题。
- 关键决策回顾：不新增方法名，`getSdkSessionId()` 这个方法名本身不算对外协议字段（调用方是 `delegation-bridge.ts` 内部代码），维持原名只改实现。

## 计划改动

- [ ] `pi-session.ts:53-69` `PiSessionConfig` 加一个必填字段 `role: 'main' | 'sub'`（与 `Conversation.role` 同语义，不做二次映射）。
- [ ] `pi-session.ts:248-258` 把硬编码 `role: 'main'` 改成 `role: this.config.role`。
- [ ] `pi-session.ts:151-154` `getSdkSessionId()` 改为 `return this.config.harnessSessionId ?? undefined;`（`harnessSessionId` 类型如果是 `string | null`，注意 null→undefined 的转换；确认调用处 `if (existing)` 判断对空字符串/null/undefined 都安全）。同时更新过时注释，说明现在返回的是 Harness 的真实持久化 sessionId，`start()` 完成后必定可用。
- [ ] 检查 `PiSessionConfig` 里 `harnessSessionId` 字段当前声明类型（`string | null` 还是 `string | undefined`），确保 `getSdkSessionId()` 返回类型与调用方期望的 `string | undefined` 对齐，不引入 TS 报错。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：计划外新增 `PiSessionConfig.parentConversationId?: string`（可选字段）。原因：`createDelegationToolDefs` 入参 `DelegationToolsOpts` 是判别联合（`MainDelegationOpts | SubDelegationOpts`），`role: this.config.role`（联合类型 `'main'|'sub'`，非字面量）无法直接匹配任一分支；`SubDelegationOpts` 还要求必填 `parentConversationId`。为不提前实施 Step2/3 的接线逻辑，新增此可选字段仅打通类型通道，`role='sub'` 分支用 `this.config.parentConversationId ?? ''` 占位。
- 改动文件清单：
  - `electron/main/agents/pi-session/pi-session.ts`：`PiSessionConfig` 新增必填 `role: 'main' | 'sub'` + 可选 `parentConversationId?: string`（原 53-69 行区块）；`getSdkSessionId()` 改为 `return this.config.harnessSessionId ?? undefined;`（原 151-154 行）；组装 `dogear-delegation` 工具包处改为按 `this.config.role` 判别联合收窄构造 `DelegationToolsOpts`（原 248-258 行）。
  - `electron/main/services/conversation-runtime-service.ts`：`attachConversation` 内唯一的 `piSessionManager.createSession({...})` 调用（第 73 行附近）联动补 `role: 'main'` 硬编码占位（TODO 注释标注 Step2 应改传 `conversation.role`），未改任何业务逻辑，仅为满足新增必填字段。
- 验收结果：`bun run build:electron` 通过（0 报错）；`bun run lint` 0 错误（83 条历史遗留 `no-explicit-any` warning，与本次改动文件无关）；改动范围仅 `git status` 确认的上述两个文件。

### 给下一步的接力棒

- `PiSessionConfig.role` 的最终类型声明和默认值处理方式：必填字段 `role: 'main' | 'sub'`，无默认值。Step2 调用处（`conversation-runtime-service.ts:73` 附近）**必须**显式传 `conversation.role`（`ConversationIndex.role` 非空必填，不需要 `?? 'main'` 兜底），目前硬编码为 `'main'` 是临时占位，Step2 必须替换。
- `getSdkSessionId()` 的最终实现与返回类型：`(): string | undefined => this.config.harnessSessionId ?? undefined`。`start()` resolve 后必定返回真实 Harness sessionId（不再是 `undefined`）。**注意**：目前 `delegation-bridge.ts:127` 是该方法唯一调用点，但该文件当前操作对象类型是 `QueryBasedSession` 不是 `PiSession`（Step3 范围），本 step 未触碰、未验证该路径，Step3 切换运行时时需重新核对时序假设。
- 下个 step 入口：`conversation-runtime-service.ts` 的 `attachConversation` 需要把 `conversation.role` 传给 `createSession({...})` 的新 `role` 字段（替换当前硬编码 `'main'`）；同时需要找到 sub 会话父会话 conversationId 的真实数据源（大概率是 `conversation.contractMetadata` 里的某字段，命名需核实是 conversationId 还是 sessionId 语义），接线给 `parentConversationId`（当前是 `?? ''` 空字符串占位，不能带着上生产，会让 `hasDirectContractChannel` 校验失效）。
- 待办或已知限制：
  1. `role` 端到端尚未生效（conversation-runtime-service.ts 硬编码 `'main'`），Step2 必须打开开关。
  2. `parentConversationId` 无真实数据源，sub 分支永远拿到空字符串占位，Step2/3 需要接线真实值。
  3. `getSdkSessionId()` 在 `delegation-bridge.ts` 里的调用时序假设尚未针对 PiSession 验证，留给 Step3。
