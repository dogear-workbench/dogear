# on_session_close 触发链路重构：下沉到会话销毁点 + 组提炼精准化

**背景**：

`on_session_close` 触发条件现状只在独立会话窗口关闭时触发（`electron/main/index.ts` 的 `createSessionWindow` closed 事件），主窗口关闭会话 tab 完全不经过调度器。且 `handleSessionClose(workspaceId)` 拿了 workspaceId 却不过滤任务——任意工作区关窗口会全局触发所有 `on_session_close` 任务。内置组提炼任务（group_digest）触发时走全量脏扫描 `triggerScanAll`。

旧架构为「关会话后精准提炼」设计的钩子 `triggerByConversation`（`electron/main/services/memory/group-digest-trigger.ts:267`，注释「触发点③：关会话后只扫该会话所属工作区/组」）在迁移到 pi 后成为死代码，本次改造将其接回。

**目标**：

1. 主窗口关闭会话 tab 与独立窗口关闭统一触发 `on_session_close`
2. 运行中的会话关闭 tab/窗口不触发（orphan 保活期间会话仍在跑）；跑完 settled 回收销毁时触发
3. 排除强杀路径：删除会话、`/clear`、`closeConversation` 等走 `closeSession` 的不触发
4. 应用退出不触发（保持现状）
5. `handleSessionClose` 按工作区过滤任务：只触发 workspaceId 匹配的任务
6. group_digest 内置任务支持精准提炼：触发上下文携带 conversationId 时只提炼该会话所在组，否则维持全量扫描

**架构**：

核心做法：把触发点从「窗口层事件」下沉到 **PiSessionManager 的会话自然销毁点**。所有关闭路径（主窗口关 tab、独立窗口关闭、orphan 跑完回收）最终都汇聚到 `_destroySession`，在其上加 `source` 参数区分自然销毁与强杀，只有自然销毁才触发调度器。

排除的选项：
- **前端关 tab 时发 IPC 触发**（保留窗口层触发点 + 新增主窗口触发点）：需要前端自行判定「运行中」，与主进程 refCount 语义重复；orphan 跑完销毁时错失触发时机；两个触发点容易双发或漏发
- **事件总线解耦**（PiSessionManager emit 事件、scheduler 订阅）：pi-session-manager 不是 EventEmitter，为单一订阅方引入事件机制过度设计；项目惯例是动态 import fire-and-forget（index.ts 旧触发点即此模式）

行为矩阵：

| 场景 | 触发？ |
|------|--------|
| 主窗口关 tab（空闲） | ✅ |
| 关 tab 时在运行 | ❌（orphan 保活，settled 后回收时 ✅） |
| 独立窗口关闭（空闲） | ✅（走新触发点，删旧调用） |
| 删除会话 / `/clear` / `closeConversation` | ❌（强杀路径） |
| 应用退出 | ❌（quitting 标志拦截） |

**模块边界**：

- `electron/main/agents/pi-session/pi-session-manager.ts`
  - `_destroySession(sessionId, source: 'natural' | 'forced')`；`release`（非 running 分支）与 `maybeCollectOrphan` 传 natural，`closeSession` 传 forced
  - natural 销毁成功后：在摘除 `conversationSessionMap` **之前**拿到 conversationId → 异步触发调度器（动态 import `scheduler-service`，fire-and-forget + catch）
- `electron/main/services/scheduler/scheduler-service.ts`
  - `handleSessionClose(workspaceId: string, conversationId: string)`：入口检查 quitting 标志；按 `task.workspaceId === workspaceId` 过滤 + enabled + 带 `on_session_close` 触发器的任务 fire，`triggerContext` 携带 `{ conversationId }`
  - 构造函数（或模块 init）监听 `app.once('before-quit')` 维护 quitting 标志（index.ts 的模块级 `isQuitting` 变量不可达）
- `electron/main/services/scheduler/runtime/plan-runner.ts` + `runtime/task-executor.ts`
  - `RunTaskOptions` 加可选 `triggerContext?: { conversationId: string }`，透传到 `executeTask`
  - task-executor 的 `group_digest` 分支：有 `triggerContext.conversationId` 时走 `triggerByConversation` 精准路径，否则维持 `triggerScanAll`；`triggerDesc` 文案带上会话/组信息便于历史排查
  - review / categorize / categorize_organize / custom 任务忽略 triggerContext
- `electron/main/services/memory/group-digest-trigger.ts`
  - `triggerByConversation(convId)` 补脏判定：查到 conversation + groupId 后先 `findDirtyGroup` 判脏，脏才 enqueue（空闲会话关 tab 无新内容时组不脏，不白跑提炼）；同时把该次结果并入 `lastScan` 活动统计或单独记录，供 executor 汇总 summary
- `electron/main/index.ts`
  - 删除 `createSessionWindow` closed 事件里的 `handleSessionClose` 调用（约 303-308 行），避免与新触发点双发
- 前端 `types/scheduler.ts`：不动（triggerContext 不进前端类型）

**数据流**：

自然销毁：关 tab / 关独立窗口 → `detachConversationRuntime` → `conversationRuntimeService.detachAttachment` → `piSessionManager.release` →（非 running）`_destroySession(source='natural')` → 摘 map 前取 conversationId → `schedulerService.handleSessionClose(workspaceId, conversationId)` → 过滤该工作区 enabled 且带 `on_session_close` 的任务 → `runner.runTask(task, { triggerContext })` → task-executor `group_digest` 分支 → `triggerByConversation(convId)` → 脏判定 → enqueue 单组 → 等队列空闲。

orphan 路径：关 tab 时 running → release 归零不销毁 → settled → `maybeCollectOrphan` → `_destroySession('natural')` → 同上（此时会话 JSONL mtime 已增长，组必脏，精准命中）。

**错误处理 / 边界情况**：

- 销毁时 conversationSessionMap 查不到 conversationId（如已 unbind）→ 不触发
- conversation-service 查不到 workspaceId / groupId → 不触发（守卫返回）
- 调度器触发链路任何错误只 `console.error`/`mainLogger.warn`，不影响会话销毁流程
- `runner.runTask` 已按 task.id 防重入，频繁开关 tab 连发触发自动跳过
- 强杀与自然销毁并发（release 后又 closeSession）：`_destroySession` 摘除动作先行，session 已不在 Map 时直接 return，不会双触发
- `triggerByConversation` 的迁移闸门 `whenMigrationReady` 已内置，保持

**未决问题**：

- custom 任务注入「刚关闭的会话」上下文到 prompt——YAGNI 砍掉，等有真实需求再加
