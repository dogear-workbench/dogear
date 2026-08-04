---
step: 3
title: delegation-bridge 会话查找路由改造
status: done
---

## 目标

把 `delegation-bridge.ts` 里硬编码的 `QueryBasedSession`/`getQueryBasedSessionManager()` 全部换成 `PiSession`/`getPiSessionManager()`，修复 `CreateSession` 必现的 `session 拉起失败` 报错；清掉不会再触发的 `session_init` 事件监听死代码。

## 依赖上下文（接力棒输入）

- 前置 step 产出：`PiSession.getSdkSessionId()` 在 `start()` resolve 后必定返回真实值；`attachConversation` 返回时其绑定的 `PiSession` 已经 `start()` 完成（`conversation-runtime-service.ts:86` `await session.start()` 在 `attachConversation` 返回之前）。
- 当前关键文件状态：`electron/main/agents/delegation-bridge.ts`
  - 第 12 行 `import { QueryBasedSession, getQueryBasedSessionManager } from './query-based-session.js';` —— 需要换成 `import { PiSession } from './pi-session/pi-session.js'; import { getPiSessionManager } from './pi-session/pi-session-manager.js';`（确认实际导出路径和命名，可能需要 barrel export，不确定的话先 Grep 一遍 `pi-session-manager.ts` 和 `pi-session.ts` 的实际 export 语句）。
  - `wireSession(childId, session: QueryBasedSession)`（第 122-129 行）：
    - 第 123-124 行 `session.on('complete', ...)` / `session.on('error', ...)` 保留不动——`PiSession` 也 emit 这两个事件，语义一致（每次 `sendMessage()` 内部的一整个 agentic turn 结束后触发一次，无论是主会话还是子会话都是这个粒度）。
    - 第 125 行 `session.on('session_init', ...)` 删除——`PiSession` 不存在这个事件，永远不会触发，是死代码。
    - 第 126-128 行的同步兜底 `const existing = session.getSdkSessionId(); if (existing) onChildSessionInit(childId, existing);` **保留**——这是本次改造后唯一生效的路径，且由于 Step1/Step2 的改动，`existing` 现在必定有值（不再是偶发的"极小概率时序竞争"兜底，而是常态路径），可以顺手把这行上面第 126 行的旧注释更新为准确描述。
  - `startChild` 第 260 行 `getQueryBasedSessionManager().getSession(attachment.sessionId)` → `getPiSessionManager().getSession(attachment.sessionId)`。`attachment.sessionId` 是 `ConversationRuntimeAttachment.sessionId`（`conversation-runtime-service.ts:108-110`），这个值本来就是 `PiSessionManager` 内部的本地 uuid key（`PiSession.getSessionId()`），本来就该用 `getPiSessionManager().getSession()` 查，硬编码查 SDK manager纯粹是历史遗留没跟上。
  - `stopChild` 第 298 行同样的替换。
  - `deliverMessage` 第 460-461 行 `getQueryBasedSessionManager().getSessionIdByConversation(...)` / `.getSession(...)` 同样替换成 Pi 版本（`pi-session-manager.ts` 已确认有 `getSessionIdByConversation`/`getSession` 对应方法，签名一致）。
  - `parent.sdkSessionId` 用法（第 200-210 行，`startChild` 内组装 `contractMetadata`）**不需要改**——这次改的是"谁来写 `conv.sdkSessionId`"（Step2 已经补上了写入路径），这里读的逻辑本来就是对的，之前只是因为没人写导致恒为空。
- 关键决策回顾：不引入 `QueryBasedSession`/`PiSession` 的联合类型或适配层——Step3（主计划）之后所有存活 conversation 都是 Pi 运行时，直接假设 `PiSession` 即可，简化实现。

## 计划改动

- [ ] 替换 import：`QueryBasedSession` → `PiSession` 类型，`getQueryBasedSessionManager` → `getPiSessionManager`。
- [ ] `wireSession` 函数签名参数类型改为 `PiSession`；删除 `session.on('session_init', ...)` 那一行；更新第 126 行注释。
- [ ] `startChild`（原第 260 行）、`stopChild`（原第 298 行）、`deliverMessage`（原第 460-461 行）三处 manager 调用点替换。
- [ ] 确认 `PiSession` 是否有 `.interrupt()` 方法供 `stopChild` 第 300 行调用（已知存在，`pi-session.ts:561` `async interrupt()`），签名兼容。
- [ ] 确认 `PiSession` 的 `error` 事件 payload 形状（`{ type: 'error', error: string, timestamp: number }`，见 `pi-session.ts:503-507`）能被 `onSessionError`/`extractErrorMessage`（第 155-175 行）正确解析——`extractErrorMessage` 已经兼容 `.error` 字段，无需改动，只需人工过一遍逻辑确认。
- [ ] `bun run build:electron` 确认无类型错误。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：无实质差异；额外顺手更新了 3 处失效注释（文件头 docstring、`ChildStateInternal.sessionId` 字段注释、`waitForChildSdkSessionId` 的 docstring），因为它们提到的 `session_init`/`QueryBasedSessionManager` 已不存在，属于同一批"文字描述准确性"改动，未触碰任何逻辑。
- 改动文件清单：仅 `electron/main/agents/delegation-bridge.ts`。

### 给下一步的接力棒

- 实际的 import 路径和导出名：
  - `import type { PiSession } from './pi-session/pi-session.js';`
  - `import { getPiSessionManager } from './pi-session/pi-session-manager.js';`
- `wireSession`/`startChild`/`stopChild`/`deliverMessage` 改造后的最终代码形态：
  - `wireSession(childId: string, session: PiSession): void` — 只保留 `session.on('complete', ...)` / `session.on('error', ...)`，`session_init` 监听已删除；紧跟 `const existing = session.getSdkSessionId(); if (existing) onChildSessionInit(childId, existing);` 保留，注释已改为"常态路径必定命中"。
  - `startChild`：`const session = getPiSessionManager().getSession(attachment.sessionId);`，其余判空/报错逻辑不变。
  - `stopChild`：`const session = getPiSessionManager().getSession(c.sessionId);`，`session.interrupt()` 调用不变。
  - `deliverMessage`：`const localSessionId = getPiSessionManager().getSessionIdByConversation(opts.toConversationId); const session = localSessionId ? getPiSessionManager().getSession(localSessionId) : undefined;`，其余不变。
- 下个 step 入口：端到端手测 `CreateSession` → `SendMessage`/`WaitForMessage` → `StopSession`/交付 全链路。
- 待办或已知限制：`onChildSessionInit`/`sdkSessionIdWaiters`/`waitForChildSdkSessionId` 这套异步等待机制**未做简化**——严格限定改动范围在 delegation-bridge.ts 内部改动逻辑本身没问题，但考虑到这三者是纯粹的死代码路径（`waitForChildSdkSessionId` 的超时分支、`sdkSessionIdWaiters` 的 push/resolve 循环、`onChildSessionInit` 里 `resolvers` 判空后的循环都永远不会被真正触发，因为 `existing` 必有值），本 step 判断这属于"精简重构"而非"路由修复"的范畴，保留原样以最小化改动面，仅更新了相关注释使其准确。如果后续 step 或用户希望进一步精简，可以考虑直接把 `waitForChildSdkSessionId` 收敛成同步读取 `c.sdkSessionId ?? null` 并删除 `sdkSessionIdWaiters` 整个 Map 及相关分支。
- `error` 事件 payload 形状已核实：`pi-session.ts:335-339` 和 `:519-523` 两处 emit 都是 `{ type: 'error', error: string, timestamp: number }`，与 `extractErrorMessage` 里 `m.error` 字段读取完全兼容，无需修正。
- `interrupt()` 方法确认存在（`pi-session.ts:577`），签名兼容，直接替换调用对象即可，无需改造。
- `bun run build:electron` 执行结果：`tsc -p tsconfig.electron.json` 无任何输出，编译通过，无类型错误。
