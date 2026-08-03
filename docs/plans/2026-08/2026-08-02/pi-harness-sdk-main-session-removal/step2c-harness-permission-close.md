---
step: 2c
title: Harness 权限与关闭语义
status: done
---

## 目标

完成 Harness 下 abort、close、release 的权限清理与持久化顺序，并回归已在 Step 2B 接入的权限状态机。

## 依赖上下文（接力棒输入）

- Step 2B 已通过 adapter 让 PiSession 使用 AgentHarness，并已将完整权限状态机接入 `tool_call` hook。
- PiSession 保留 dontAsk、豁免规则、会话 allow、持久 allow、前端响应和 pending permission Map。
- Harness `settled` 与 `save_point` 已可作为关闭前写入完成的同步边界。
- 不允许以默认放行、移除工具确认或跳过权限回归来规避适配难度。

## 计划改动

- [ ] 回归确认 adapter/PiSession 的 `tool_call` 权限接口、`permissionRequest` 事件与 `respondPermissionRequest` 方法签名保持完整语义。
- [ ] 回归确认 dontAsk、豁免规则、session allow、persistent allow、allow、deny 与编辑工具输入后的执行结果。
- [ ] 将 interrupt、close、PiSessionManager release 的处理收敛为：清队列、abort、拒绝 pending permission、等待/确认 `settled` 与 `save_point` 已完成写入后释放；避免死锁和未处理 rejection。
- [ ] 执行 `bun run build:electron`，手动验证工具允许、拒绝、always allow、编辑后允许、中断、关闭重开恢复。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：计划要求的六项手动验证场景（允许/拒绝/always_allow/编辑后允许/中断/关闭重开恢复）**只完成了应用启动、切工作区、新建对话、模型选择器 UI 路径的验证**，未能在可用时间内跑通一次真正触发 `tool_call` 权限确认的实时模型交互——本地开发环境 `.dogear/settings.json` 的 `defaultModelSelection.tier='sonnet'` 对当前 GLM profile（`apiFormat:'pi'`，`piModels` 只有 `glm-4.5-air/glm-4.7/glm-5.2`）无效，新对话默认选中的模型直接报错，需要手动在模型选择器里切一个有效档位才能发消息。这个环境问题 Step 2B 交付时已提前标注过，Step 2C 两轮都卡在同一处。核心的"挂起权限时 close/interrupt 是否死锁"验证强度停留在**静态代码审查 + 已读 `agent-harness.js:912-942` 源码交叉论证**，不是运行时实测结果。用户已知悉此缺口，决定接受现状，把这个场景的实测放到 Step 2D（端到端人工回归）里做，不再为此单独重派。
- 改动文件清单：
  - `pi-harness-adapter.ts`：`abort()` 从 `void`（fire-and-forget）改为 `async (): Promise<void>`，内部 `await this.harness.abort()` 并吞掉 harness 内部 `AggregateError`（只 `logger.warn`，不上抛）。
  - `pi-session.ts`：`close()` 改为返回 `Promise<void>`，加 `closingPromise` 重入锁；内部 `doClose()` 顺序改为「先 `rejectAllPendingPermissionRequests` → 再 `await adapter.abort()` → 再置 `status=CLOSED`/清零/`emit('sessionClosed')`/`removeAllListeners()`」防死锁+防丢事件；`interrupt()` 补上遗漏的 `await adapter.abort()`，未加重入锁（有源码依据，见下）。
  - `pi-session-manager.ts`：`release()`/`closeSession()`/`_destroySession()` 改 `async` 并正确 `await` + `try/catch` 兜底；`closeAll()` 对每个 session 的 `close()` 套 `Promise.race([close(), 5s超时])` 避免阻塞 app 退出。
  - `tipc/agent.ts`：`closeQueryBasedSession` 补 `await`；`interruptQueryBasedSession`/`setPermissionMode` 补齐既有的 pi fallback 缺口（原本只查 SDK manager，pi 主会话点"中断"/切权限模式会收到"会话不存在"，照抄 `respondPermissionRequest` 已有模式修复）。

### 给下一步的接力棒

- Step 2B 的 tool_call hook 权限接口和返回语义回归结果：**代码层面确认未受影响**——本步骤完全没有触碰 `handleToolCall`/`respondPermissionRequest`/`isPermissionExempt`/`isToolPreapproved`/`pendingPermissionRequests` 任何一行，改动只集中在 `close()`/`interrupt()`/`doClose()`。未做实测确认。
- Step 2B 的编辑输入验证结果回归：同上，`Object.assign(pending.args, updatedInput)` 原地改写逻辑未改动，`handleToolCall` 本身没变，前提没有被破坏。未做实测。
- abort/close/release 落盘顺序：`doClose()` = 先 `rejectAllPendingPermissionRequests`（让卡在 `tool_call` hook 里的 Promise 立刻 resolve 成 `{block:true}`，避免下一步的 `harness.waitForIdle()` 永久等待）→ `await adapter.abort()`（resolve 即代表本轮含工具调用已完全结束、`settled` 已触发）→ 收尾（`status=CLOSED`/`emit('sessionClosed')`/`removeAllListeners()`，`removeAllListeners()` 必须最后执行避免丢弃 abort 收尾期间的最后几个事件）。`interrupt()` 同样顺序但不做收尾。`_destroySession()` 先从三个 map 摘除再 `await session.close()`，即使 close 卡住 sessionId 也已不可能被重复拿到。
- 已知限制：① 核心死锁场景只有静态论证没有实测，Step 2D 需要第一优先级补测（建议用 `glm-4.7` 而非 `glm-5.2`，后者有独立的流式卡顿已知问题，混在一起不好排查）。② `interrupt()` 未加重入锁，依据是 `AgentHarness.abort()` 源码显示并发调用天然安全（steerQueue/followUpQueue 提前清空、AbortController 重复 abort 是 no-op、多个调用者可共享同一个 `runPromise`），但未做并发点击实测。③ `closeAll()` 的 5 秒超时是经验值，未验证真正卡住的 session 是否会被超时放行。④ 发现 `shutdownPiSessionManager()` 未接入 `electron/main/index.ts` 的 app 退出钩子（对照 `shutdownQueryBasedSessionManager()` 是被调用的），既有缺口不在本步骤范围，供后续参考。
- 下个 step 入口：Step 2D 进行端到端人工回归、构建和仅针对真实事件顺序问题的修正，**优先补齐本步骤遗留的中断/关闭/挂起权限死锁场景实测**（本步骤这部分只做到代码审查强度）。
