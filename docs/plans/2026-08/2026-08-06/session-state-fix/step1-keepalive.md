---
step: 1
title: B1 保活机制
status: done
---

## 目标

PiSessionManager release 归零时，如果 session 仍在 running 则保留不销毁（orphan 保活）；turn 自然结束后 orphan session 自动销毁。re-attach 路径复用现有 getSessionIdByConversation + retain。

## 依赖上下文（接力棒输入）

- 关键文件：
  - `electron/main/agents/pi-session/pi-session-manager.ts` — `release()` 在 L143，`_destroySession()` 在 L191
  - `electron/main/agents/pi-session/pi-session.ts` — `running` 字段 L148，`handleSettled()` L502，`syncSessionState()` L530
- 当前 `release()` 逻辑：`refCount - 1`，归零直接 `_destroySession()`
- 当前 `handleSettled()`：`this.running = false` + `syncSessionState()`
- `conversationSessionMap`（conversationId↔sessionId）在 `_destroySession()` 里才摘除，保活期间不摘

## 计划改动

- [ ] `pi-session.ts`：新增 `isRunning(): boolean` 方法，返回 `this.running || this.pendingSteerCount > 0`
- [ ] `pi-session.ts`：`handleSettled()` 末尾调 Manager 的 orphan 收集入口（emit 一个事件或直接调 Manager 方法）
- [ ] `pi-session-manager.ts`：`release()` 归零时检查 `session.isRunning()`：
  - running → refCount 置 0，不从 sessions Map 删除，不摘 conversationSessionMap，return 0
  - idle → 照旧 `_destroySession()`
- [ ] `pi-session-manager.ts`：新增 orphan 收集方法（如 `maybeCollectOrphan(sessionId)`）：refCount==0 则 `_destroySession()`；由 PiSession 的 settled 回调调用
- [ ] 验证：关闭正在运行的会话 tab → session 保留 → 切回 → 内容对上；自然跑完后 orphan 销毁

## 实施回填（做完后填）

### 实际改动
- 与计划差异：选择了 emit `settled` 事件 + Manager 在 createSession 时挂监听器的方式（而非 PiSession 直接调 Manager 方法），保持与现有事件模式一致，避免 PiSession 反向依赖 Manager。语义等价。
- 改动文件清单：
  1. `electron/main/agents/pi-session/pi-session.ts` — 新增 `isRunning()` 方法；`handleSettled()` 末尾新增 `this.emit('settled')`
  2. `electron/main/agents/pi-session/pi-session-manager.ts` — `release()` 归零时检查 `isRunning()` 走 orphan 保活；新增 `maybeCollectOrphan()`；createSession 内挂 `settled` 监听器

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `PiSession.isRunning(): boolean` — `this.running || this.pendingSteerCount > 0`
  - `PiSessionManager.maybeCollectOrphan(sessionId): Promise<void>` — refCount==0 则 `_destroySession()`
  - PiSession emits `'settled'` 事件（无 payload），由 Manager 在 createSession 时挂监听器
- 下个 step 该从哪里继续：B2 停止按钮死锁，改 `delegation-bridge.ts` 和 `pi-session.ts` 的 `interrupt()`/`close()`
- 待办或已知限制：无
