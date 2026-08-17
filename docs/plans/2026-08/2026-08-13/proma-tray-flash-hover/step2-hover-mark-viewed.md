---
step: 2
title: 悬停气泡空闲不弹 + 点击标记已读
status: done
---

## 目标
完全空闲（无任何 running / 待介入会话）时悬停托盘不弹气泡；点气泡里某会话后打开对应会话并把它标记为已读，让托盘闪烁随处理进度收敛。

## 依赖上下文（接力棒输入）
- Step 1 产出：`setTrayFlash(on)` 已接线，闪烁依据 `sessions.some(s => s.attention)`；`SurfaceDeps` 新签名 `{ sendPlaySound, soundEnabled }`
- 悬停窗口：`apps/electron/src/main/agent-status-hover-window.ts` — `show(bounds)` 无条件 showInactive；`updateSnapshot(snapshot)` 缓存 + 可见时推送；`onTrayMouseEnter` 300ms 延迟 show
- 打开会话链路：`apps/electron/src/main/ipc.ts:5334-5350` `OPEN_SESSION` handler → 转发 `TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION` + 聚焦主窗口
- 状态机：`apps/electron/src/main/lib/agent-island-service.ts` — `markAgentIslandSessionViewed(sessionId)` 目前是私有函数（约 662 行），只清 completed/error 的 unread/attention，幂等
- snapshot 结构：`state.sessions` 为空时 `buildState` 会填 `recentSessions`（launchpad），判断「完全空闲」只看 `state.sessions.length`

## 计划改动

### 1. `apps/electron/src/main/lib/agent-island-service.ts`
- [ ] `markAgentIslandSessionViewed` 从私有函数改为 `export function`（位置约 662 行附近）

### 2. `apps/electron/src/main/agent-status-hover-window.ts`
- [ ] `show(bounds)` 开头加：`latestSnapshot` 不存在或 `state.sessions.length === 0` 时直接 return，不 showInactive
- [ ] `updateSnapshot(snapshot)` 中：窗口可见且新 snapshot 的 `state.sessions.length === 0` 时调 `this.hide()`（气泡打开期间会话被处理清空 → 自动消失）

### 3. `apps/electron/src/main/ipc.ts`
- [ ] `OPEN_SESSION` handler 中，`isNonEmptyString(sessionId)` 校验通过后、转发前，调用 `markAgentIslandSessionViewed(sessionId)`（用动态 `await import('./lib/agent-island-service')` 或确认无循环依赖后静态 import）
- [ ] 其余逻辑（转发 OPEN_AGENT_SESSION + restore/show/focus）不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. ipc.ts 用静态 import（未用动态 import）——该服务本就已被 ipc.ts 静态 import，无循环依赖。
  2. `agent-status-hover-window.ts` 中保留的未提交改动 `alwaysOnTop: true` 一并纳入本次提交（用户已确认）。
- 改动文件清单：
  - `apps/electron/src/main/lib/agent-island-service.ts`
  - `apps/electron/src/main/agent-status-hover-window.ts`
  - `apps/electron/src/main/ipc.ts`

### 给下一步的接力棒
- `markAgentIslandSessionViewed` 已导出，签名 `(sessionId: string) => void`，幂等，只清 completed/error 的 unread/attention。
- 「完全空闲」判定 = `snapshot.state.sessions.length === 0`（忽略 recentSessions）。
- 下个 step 做版本号 + 端到端验证。
