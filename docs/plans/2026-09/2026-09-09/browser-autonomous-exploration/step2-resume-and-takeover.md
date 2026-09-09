---
step: 2
title: 接回 Agent 与接管互斥锁
status: pending
---

## 目标

「我已完成，继续任务」真正唤醒会话从当前页继续；tab 增加显式接管锁：接管后 agent 写操作被拒，交还时 generation 递增旧 ref 失效并唤醒。

## 依赖上下文（接力棒输入）

- `human-intervention.ts:83` `resolveHumanIntervention(id, 'user')` 目前返回 boolean 且丢弃 request；PendingIntervention 内有 `taskMeta`（含 conversationId）
- `pi-session-manager.ts`：`getSessionIdByConversation(conversationId)` → sessionId、`getSession(sessionId)` → PiSession；`pi-session.ts:912` `sendMessage` 已内置 paused/idle→prompt、running→steer，直接复用
- 依赖方向红线：services 不得 import agents（防反向依赖），唤醒 glue 必须放 `tipc/browser.ts` 路由层
- `tipc/browser.ts:143` resolveHumanIntervention 路由现状：仅调服务层返回 `{ resolved }`
- 写工具入口：`browser-atom-tools.ts`（navigate/wait_for/scroll 等）与 `browser-action-tools.ts`（click/fill/press）各自 handler 内 `withAgentTab` runner 拿 record—— takeover 检查放 runner 内最省（一处覆盖全部写工具），读工具（observe_page/find/read_text/read_state/screenshot）不拦
- generation 递增：看 `tab-events.ts` 现有递增函数（导航/SPA 时调用），bump 需要一个显式入口（embedded-browser-manager 或 tab-events 导出）
- 设计文档：第一批 3/4；全局决策「唤醒链路唯一入口」「唤醒消息模板」

## 计划改动

- [ ] `human-intervention.ts`：`resolveHumanIntervention(id, 'user')` 返回值改 `HumanInterventionRequest | null`（含 taskMeta 的完整版，内部类型 `ResolvedIntervention`），auto 解除路径不变不唤醒
- [ ] `tipc/browser.ts` 新增私有 `resumeConversation(conversationId: string, message: string)`：查会话 → 存在则 `session.sendMessage(message)`（fire-and-forget + catch 日志）；不存在仅日志。消息模板：「用户已在浏览器完成人工处理（{reason}，页面当前 URL: {url}）。请重新观察该 tab 的当前页面状态后继续任务，不要从头重跑，不要重放旧 ref。」
- [ ] `tipc/browser.ts` resolveHumanIntervention 路由：resolve 成功且 `taskMeta.conversationId` 非空 → 调 `resumeConversation`；`article` kind（无 conversationId）维持现状
- [ ] `embedded/types.ts` Tab 模型加 `takeover: { active: boolean; taskMeta?: BrowserTaskMeta } | null`
- [ ] `embedded-browser-manager.ts`：`takeOverTab(tabId, taskMeta?)` / `releaseTakeover(tabId)` / `isTabTakenOver(tabId): boolean` + release 内调 generation 递增
- [ ] `tab-events.ts`（或 manager）：导出 `bumpGeneration(tabId)` 显式递增（对齐现有导航递增语义，事件不额外发）
- [ ] `browser-atom-tools.ts` / `browser-action-tools.ts` 的 agent tab runner：拿到 record 后写类工具统一前置检查 `isTabTakenOver` → `isErrorResult('user_takeover：用户已接管该页面，操作暂停。请停止页面操作，等待用户交还控制权后重新观察继续')`
- [ ] `tipc/browser.ts` 新路由 `takeOverTab` / `releaseTakeover`：release 时若 takeover.taskMeta.conversationId 存在 → `resumeConversation`（消息：「用户已交还页面控制权。请重新 observe_page 观察当前页面后继续任务，旧 ref 已全部失效」）；接管状态变化广播 `tabTakeoverChanged`（全量 `{tabId, active}[]`，注册进 `renderer-handlers.ts`）
- [ ] `browser-store.ts`：takeovers 状态 + 订阅 `tabTakeoverChanged` 全量刷新
- [ ] `BrowserPageView.tsx` tab 行加「接管/交还」小按钮（最小可用版，完整 UI 归 Step 4）：接管调 `takeOverTab`（taskMeta 传当前 holder 会话——从动作流 status.holder 拿不到就传 undefined，交还时无会话可唤醒则只解锁）
- [ ] 浏览器解析 Profile 描述（`settings-types.ts` 内模板）：补「页面被用户接管时写操作会被拒绝，收到 user_takeover 后应停下等待，交还后会收到继续提示」一句

## 验收

- 会话 running 中人工介入 → 点「完成后继续」→ 会话收到 steer 插话且消息含当前 URL；会话 idle 时 → 新 prompt 唤醒
- 接管后 agent 的 click 返回 isError 且文案含 user_takeover；observe_page 仍可用
- 交还后：generation 已递增（旧 ref 点击报 ref_expired）、会话收到唤醒消息
- `bun run build:electron` + `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
