---
step: 2
title: delegation-bridge 骨架
status: pending
---

## 目标

把 `delegation-bridge.ts` 做出来：维护活跃子会话状态机 + Promise 挂起池 + 子会话拉起接 agent-manager。本步不接工具（工具是 Step 3），但所有运行时机制要跑通，能用 IPC 临时手测 startChild → submitDelivery 闭环。

同时把 `agent-query-config.ts` 的 `resolveModelSelection` 加上 sub-agent fallback 层（让子会话自动走 `settings.subAgent.modelSelection`）。

## 依赖上下文（接力棒输入）

- Step 1 落了：
  - `AppSettings.subAgent` 字段（modelSelection? / permissionMode? / timeoutMinutes）
  - `conversation-service.create()` 接受 `options.{role,parentConversationId,cachePolicy}`
  - `group-shared-service.claimOutputPath / releaseOutputPath / releaseAllByChild`
  - `types/delegation.ts`：`ChildStatus / DelegateSpec / DeliveryResult / ChildStateSnapshot`
- 现有 agent-manager 在 `electron/main/agents/agent-manager.ts`，对外用 `enqueueTask(task)` 拉 worker（task type 见 `task-types.ts`）
- 现有 QueryBasedSession 在 `query-based-session.ts`，CHAT_SESSION 任务由 worker 内部走 `chat-skill.ts` 的 ChatSession
- `agent-query-config.ts:136` 是 `resolveModelSelection`，当前 `selection ?? fallback` 两层。要插中间 subAgent 层

## 关键路径修正（2026-06-26）

**原计划假设子会话走 agent-manager + CHAT_SESSION 任务，错。** 调查发现：
- agent-manager + CHAT_SESSION 是旧路径（chat-skill.ts/ChatSession），主 UI 对话**不走这条**
- 主 UI 对话走 `attachConversation` → `QueryBasedSessionManager.createSession` → `session.sendMessage`，**完全在主进程内，不经 Worker**
- CHAT_SESSION 任务无 AbortController，`cancelTask` 对它是 no-op
- `QueryBasedSession` 已自带 `interrupt()`、`complete`/`error` 事件、modelSelection/MCP/skills/permissions 全套配置

**改走 QueryBasedSession 直拉路径**：子会话和主 UI 对话同一条链，bridge 只挂内存状态机 + 事件桥。好处：abort 真能 abort、用户随时点入子会话 tab 就是普通对话、零额外 UI 接管成本。

## 计划改动

### 1. `electron/main/agents/agent-query-config.ts`
- `resolveModelSelection` 签名扩展：增加 `subAgentFallback?: ModelSelection | null` 参数，三层 fallback：`selection ?? subAgentFallback ?? fallback`
- 不破坏现有调用方（默认 undefined 时行为不变）
- 注意：子会话拉起目前**不走** `buildQueryBaseConfig`（attach 路径内部有自己的 config 组装），但 subAgentFallback 仍然要加，留给将来或非 attach 路径用。本步同时还要在 attach 链路上能把 subAgent fallback 接进去——做法：让 bridge 在调 `conversationService.create` 前自己算好 `modelSelection`（三层 fallback），写入 conversations.json，后续 attach 自然读到正确值，**resolveModelSelection 不必侵入 attach 内部**

### 2. `electron/main/agents/delegation-bridge.ts`（新文件）

**导入**：
- `getQueryBasedSessionManager` from `./query-based-session.js`
- `conversationRuntimeService`（默认导出单例）from `../services/conversation-runtime-service.js`
- `conversationService.create / getById` from `../services/conversation-service.js`
- `groupSharedService.claimOutputPath / releaseOutputPath / releaseAllByChild / readNativeFile` from `../services/group-shared-service.js`
- `getSettings()` from settings-service
- `mainLogger.child('delegation-bridge')`
- 类型 from `../types.js`（ChildStatus / DeliveryResult / ChildStateSnapshot / DelegateSpec）

**顶层 ES module 状态（进程级单例）**：
```ts
const childStates = new Map<string, ChildStateInternal>();      // key = childId（conversationId）
const waitStates = new Map<string, WaitStateInternal>();        // key = waitId (uuid)
const askPending = new Map<string, AskPendingInternal>();       // key = childId（Step 5 实装）
```

类型：
- `ChildStateInternal = ChildStateSnapshot & { attachmentId: string; sessionId: string; timeoutTimer?: NodeJS.Timeout }`
- `WaitStateInternal = { id, parentConversationId, childIds: string[], resolve: (DeliveryResult[]) => void, timer: NodeJS.Timeout }`
- `AskPendingInternal = { resolve: (string) => void; question: string; askedAt: number }`（Step 5 用）

**导出方法**：

#### `startChild(opts): Promise<ChildStateSnapshot>`
入参：`{ parentConversationId: string, workspaceId: string, groupId: string, spec: DelegateSpec }`

实现：
1. 拿 settings：`const settings = await getSettings()`
2. 拿 parent conversation：`const parent = await conversationService.getById(parentConversationId)` 取 `parent.modelSelection` 和 `parent.cachePolicy`
3. claim outputPath（先生成一个 childId 占位用）：先 `const childId = uuidv4()` 不行——childId 应该是 conversation.id，但 create 之前没有。**改：先创建 conversation 拿到 id，再 claim；如果 claim 失败就 delete conversation**
4. 解析子会话 modelSelection：`parent.modelSelection ?? settings.subAgent?.modelSelection ?? settings.ai.defaultModelSelection`（注：父会话有自己的偏好就继承父，没有再走 subAgent，最后兜底 default）
5. `const title = spec.title ?? `子会话: ${spec.task.slice(0, 30)}`
6. `const childId = await conversationService.create(workspaceId, groupId, title, modelSel, { role: 'sub', parentConversationId, cachePolicy: parent.cachePolicy })`
7. claim：`const claim = await groupSharedService.claimOutputPath(workspaceId, groupId, spec.outputPath, childId)`。失败：删除刚建的 conversation（调 `conversationService.delete`，如果没有就接受脏数据但 throw），throw with reason
8. attach：`const attachment = await conversationRuntimeService.attachConversation(childId, workspaceId, 'desktop', {})`，拿到 `attachmentId` 和 `sessionId`
9. 拿 session：`const session = getQueryBasedSessionManager().getSession(sessionId)`，断言非空
10. 注册 ChildStateInternal：status='running', startedAt=Date.now(), attachmentId, sessionId, outputPath, title, etc.
11. wireSession：监听 `session.on('complete', ...)` 和 `session.on('error', ...)`（见下文 wireSession helper）
12. 设置超时：`timeoutTimer = setTimeout(() => onTimeout(childId), settings.subAgent.timeoutMinutes * 60_000)`
13. emit `childStatusChanged` + 触发 deliveriesAwaitChanged
14. **fire-and-forget**：`session.sendMessage(spec.task).catch(err => onSessionError(childId, err))`
15. return snapshot

#### `submitDelivery(childId, summary, outputPath): Promise<void>`
1. 拿 child，断言存在且 status='running'，否则 throw `'子会话不在运行状态'`
2. `outputPath !== child.outputPath` → throw `'outputPath 不匹配'`
3. 读文件：`const content = await groupSharedService.readNativeFile(child.workspaceId, child.groupId, outputPath)`（throw 包装为 `'交付物文件未写入或读取失败'`）
4. 校验非空：`content.trim().length === 0` → throw `'交付物为空'`
5. 更新 child.status='done', summary, finishedAt=Date.now()
6. 释放 claim：`groupSharedService.releaseOutputPath(child.workspaceId, child.groupId, outputPath, childId)`
7. 清超时 timer
8. emit `childStatusChanged` + `deliveriesAwaitChanged`
9. 推进 waitStates（resolveIfAllTerminal）
10. **不**自动 detach session——保留运行（子会话还可能 askParent 或被 SendMessageToChild 继续聊）。只有显式 stopChild 才 detach

#### `waitFor(parentConversationId, childIds, timeoutMs?): Promise<DeliveryResult[]>`
1. 校验所有 childIds 的 child 都属于 parentConversationId（child.parentConversationId === parentConversationId），否则 throw
2. 快速路径：检查是否全部 terminal（status !== 'running'），是则直接 resolve `buildResults(childIds)` 返回
3. 否则：生成 waitId（uuid），注册 waitStates，设 timer：超时则 onWaitTimeout（把还在 running 的 child 强制 mark 'timeout' + interrupt + detach + release claim + emit），然后 resolve `buildResults(childIds)`
4. 返回 promise

`buildResults(childIds)`：按 childIds 顺序，从 childStates 拿 snapshot 转 DeliveryResult

#### `stopChild(childId, reason: 'cancelled' | 'timeout' = 'cancelled'): Promise<void>`
1. 拿 child，若已 terminal 直接 return
2. mark child.status=reason, finishedAt=Date.now(), errorMessage=reason==='timeout'?'超时中断':'被父会话停止'
3. 清超时 timer
4. session.interrupt() + conversationRuntimeService.detachAttachment(child.attachmentId)（try/catch 套住，失败记 log 不抛）
5. 释放 claim
6. emit `childStatusChanged` + `deliveriesAwaitChanged`
7. 推进 waitStates

#### `wireSession(childId, session)` 内部 helper
- `session.on('complete', () => onSessionComplete(childId))`
  - onSessionComplete：若 child.status === 'running'（子 agent 自然停了没调 SubmitDelivery）→ mark 'no_delivery' + 清 timer + 释放 claim + emit + 推进 waitStates。注意不 detach，因为 sub 可能后续被父再次发消息
- `session.on('error', (msg) => onSessionError(childId, msg))`
  - mark 'failed' + errorMessage + 同上

#### `getChildrenByParent(parentConversationId): ChildStateSnapshot[]`
扫 childStates 过滤 parent 匹配，返回 snapshot 副本

#### `getChildSnapshot(childId): ChildStateSnapshot | null`
读 childStates 返副本

#### `askParent(...)` / `replyToChild(...)` / `abortWaitsForParent(...)`
**留存根**，body 是 `throw new Error('not implemented (Step 5/7)')` 或空函数（保证 Step 3-7 import 不报错）

### 3. `electron/main/tipc/renderer-handlers.ts`
- 加 2 个事件：
  ```ts
  childStatusChanged: (data: { parentConversationId: string; childId: string; status: ChildStatus; snapshot: ChildStateSnapshot }) => void;
  deliveriesAwaitChanged: (data: { parentConversationId: string; runningCount: number; doneCount: number }) => void;
  ```
- 类型 ChildStatus/ChildStateSnapshot 从 `../types.js` import
- emit 工具：bridge 内部用 `BrowserWindow.getAllWindows().forEach(w => getRendererHandlers<RendererHandlers>(w.webContents).childStatusChanged.send(data))`（仿其他事件，参考 `tipc/agent.ts` 里 `queryBasedSessionMessage.send`）

### 4. 临时手测 IPC（Step 3 末尾删）
在 `electron/main/tipc/agent.ts` 加 3 个调试 RPC，方法名前缀 `__debug_`：
- `__debug_startChild({ parentConversationId, workspaceId, groupId, task, outputPath })` → 调 bridge.startChild
- `__debug_submitDelivery({ childId, summary, outputPath })` → 直接调 bridge.submitDelivery（模拟子会话端调，**前提**：先手动 WriteGroupFile 写过 outputPath，本步可以临时塞个 `__debug_writeAndSubmit({ childId, outputPath, summary, content })` 一把搞定）
- `__debug_waitFor({ parentConversationId, childIds, timeoutMs })` → bridge.waitFor，console.log 结果

### 3. `electron/main/tipc/renderer-handlers.ts`
- 加 2 个事件：
  ```ts
  childStatusChanged: (data: { parentConversationId: string; childId: string; status: ChildStatus; snapshot: ChildStateSnapshot }) => void;
  deliveriesAwaitChanged: (data: { parentConversationId: string; runningCount: number; doneCount: number }) => void;
  ```

### 4. 临时手测 IPC（done 后删除）
- `electron/main/tipc/agent.ts` 加 3 个调试 RPC（仅本步用，Step 3 后删除）：
  - `__debug.startChild(parentConversationId, task, outputPath)` → 调 bridge.startChild
  - `__debug.submitDelivery(childId, summary)` → 模拟子会话端调
  - `__debug.waitFor(parentConversationId, childIds)` → 调 bridge.waitFor，console.log 结果
- 或者更简单：临时在主进程启动后跑一段自检脚本（用 DOGEAR_DEBUG_BRIDGE 环境变量门控），跑完打日志

## 验证

- `bun run build:electron` 通过
- `bun run lint` 通过
- 手测路径（用调试 IPC 或自检脚本）：
  1. 启 app，建一个组，建一个主会话
  2. `__debug.startChild(mainConvId, "echo hello", "test.md")` → 看 conversations.json 出现新 sub conversation，bridge 内存有 childState
  3. 等几秒（子会话会真跑起来，但因为它不知道要 SubmitDelivery，会一直 running 或 no_delivery）
  4. `__debug.submitDelivery(childId, "done")`：要先手动 WriteGroupFile 写 test.md，否则 submitDelivery 会校验失败
  5. waitFor 应 resolve，看到 status='done'
  6. 测 timeout：startChild 后立即 waitFor 传 timeoutMs=2000，等 2 秒后 resolve 应是 status='timeout'
  7. 测 outputPath 冲突：startChild 同路径两次，第二次应 throw
- 验证完留下"调试 IPC"以便 Step 3 接工具时复用（Step 3 结束才删）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `getSettings()` 实际导出名为 `loadSettings()`（settings-service.ts:47），已正确使用
  - `ChildStateInternal` 新增 `workspaceId` 字段（文档里有提到），因为 submitDelivery/stopChild 需要 workspaceId 去操作共享区，snapshot 类型不含此字段
  - `wireSession` 入参类型直接用 `QueryBasedSession`（从 query-based-session.ts 导入），避免 `any`
  - 调试 IPC `__debug_submitDelivery` 改名为 `__debug_writeAndSubmit`，入参加 `workspaceId`，因为 `ChildStateSnapshot` 不暴露 workspaceId

- 改动文件清单：
  - `electron/main/agents/agent-query-config.ts` L136-142：`resolveModelSelection` 签名加 `subAgentFallback` 第 3 参；L179-184：`buildQueryBaseConfig` 内调用插入 `null`
  - `electron/main/agents/agent-worker.ts` L589, L685, L801：三处调用各插入 `null` 作为 `subAgentFallback`
  - `electron/main/agents/delegation-bridge.ts`：新建，约 230 行
  - `electron/main/tipc/renderer-handlers.ts` L3-4：追加 `ChildStatus/ChildStateSnapshot` import；L210-227：追加 `childStatusChanged` 和 `deliveriesAwaitChanged` 两个事件字段
  - `electron/main/tipc/agent.ts` L834-869：追加 3 个调试 procedure

### 给下一步的接力棒

- bridge 导出方法最终签名：
  - `startChild(opts: StartChildOptions): Promise<ChildStateSnapshot>`
  - `submitDelivery(childId: string, summary: string, outputPath: string): Promise<void>`
  - `waitFor(parentConversationId: string, childIds: string[], timeoutMs?: number): Promise<DeliveryResult[]>`
  - `stopChild(childId: string, reason?: 'cancelled' | 'timeout'): Promise<void>`
  - `getChildrenByParent(parentConversationId: string): ChildStateSnapshot[]`
  - `getChildSnapshot(childId: string): ChildStateSnapshot | null`
  - `askParent(_childId, _question): Promise<string>` — throws Step 5 未实现
  - `replyToChild(_childId, _answer): void` — throws Step 5 未实现
  - `abortWaitsForParent(_parentConversationId): void` — Step 7 实装，目前空函数

- `agent-manager` 是否需要新增任务完成事件 hook：不需要。bridge 直接挂 QueryBasedSession 的 `complete`/`error` 事件，完全绕过 agent-manager。

- `resolveModelSelection` 现在的三层 fallback 调用约定（参数顺序）：
  `resolveModelSelection(appSettings, selection, subAgentFallback, fallback, configDir)`
  - `selection`：对话级模型选择（主会话/后台任务自己的 selection）
  - `subAgentFallback`：子会话场景传 `settings.subAgent?.modelSelection`；普通场景传 `null`
  - `fallback`：全局 default（`settings.ai.defaultModelSelection` 或具体任务的 digestModelSelection 等）
  - `configDir`：`.dogear` 目录路径

- ChildStatus 流转图：
  - `running` → `done`：子会话调 SubmitDelivery，bridge.submitDelivery() 成功
  - `running` → `no_delivery`：QueryBasedSession emit `complete` 但子会话未调 SubmitDelivery（onSessionComplete 触发）
  - `running` → `failed`：QueryBasedSession emit `error`（onSessionError 触发），或 session.sendMessage 抛出
  - `running` → `timeout`：超时 timer 触发 stopChild(id, 'timeout')
  - `running` → `cancelled`：父会话调 stopChild(id, 'cancelled')
  - 注意：`no_delivery` 时不 detach session，子会话仍可被父会话 SendMessageToChild 续聊（Step 4 实装）

- 临时调试 IPC 保留位置（Step 3 末尾删）：
  `electron/main/tipc/agent.ts` 末尾，三个 procedure：
  - `__debug_startChild`
  - `__debug_writeAndSubmit`
  - `__debug_waitFor`

- 已知坑 / 待办：
  - `no_delivery` 时不 detach，意味着 session 引用计数不减少。Step 4/5 的 StopChild/SendMessageToChild 工具调用完后需显式 stopChild 来 detach
  - `waitFor` 超时回调内用 `Promise.all(pending.map(id => stopChild(id, 'timeout')))` 是 async，timer 到期后 resolve 可能比各 stopChild 的 broadcast 略晚，前端可能先收到 waitFor 结果再收到 childStatusChanged，但不影响正确性
  - bridge 内存状态不持久化，app 重启后 `running` 子会话从 bridge 视角消失（状态成孤儿），conversations.json 里仍存在，用户可手动续聊
