---
step: 2
title: 删除挂起机制并切换提示词
status: done
---

## 目标

原子切换：删除 WaitForMessage 工具与 waiter 挂起机制，提示词改为「派单后结束回合」，交付与终态只走消息注入出口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-inject-outlet.md] 已建立注入出口（notifyTerminalToWaiters 无 waiter 时注入，可能抽出共用推送函数）
- 关键文件状态：`deliverMessage` 与 `notifyTerminalToWaiters` 均具备注入能力；`waitForMessage()`（delegation-bridge.ts:774）注册 waiter、`abortMessageWaits`（:832 附近）解 waiter
- 工具注册：`dogear__WaitForMessage` 在 pi-session.ts（grep `dogear__WaitForMessage` 定位 schema 与 handler）
- 提示词：session-append-templates.ts:29-30（派单后必须 WaitForMessage 的规则）、:133（triggerDescription）
- 关键决策：工具删除 + waiter 删除 + 提示词切换必须在同一步完成——任何一项滞后都会留下破坏性中间态（模型仍调工具但无人 resolve → 干等超时；或提示词已改但工具还在 → 模型行为摇摆）
- 存量会话兼容：升级时上下文里已教过 WaitForMessage 的进行中会话，模型可能仍调用已删除的工具名 → unknown tool 报错。实施时验证模型容错表现；若表现差，保留一个同名占位工具（立即返回「等待机制已升级：请直接结束回合，交付会作为新消息唤醒你」），观察一个版本后再删

## 计划改动

- [x] pi-session.ts：删 `dogear__WaitForMessage` 工具注册、handler、`abortMessageWaits` 调用（interrupt 里的死锁兜底随挂起机制消失）
- [x] delegation-bridge.ts：删 `waitForMessage()`、`messageWaiters`、`abortMessageWaits`；`deliverMessage` / `notifyTerminalToWaiters` 收口为单一注入出口
- [x] delegation-terminal.ts：删 `collectTerminalWaiterKeys`、`TerminalWaiterLike` 等 waiter 专用辅助（buildTerminalNotice 保留）
- [x] session-append-templates.ts：派单指引改为「派单后输出简短收尾语并结束回合；交付/终态会作为新消息自动唤醒你，无需调用任何等待工具」；:133 triggerDescription 同步
- [x] 全局 grep `WaitForMessage` 清理残留引用（含类型定义、系统提示词其他段落）
- [x] 验证完整链路：派单 → 主会话 stop → 等待期插话即时生效 → 子会话交付注入唤醒主会话续跑；再验一条终态链路（停掉子会话 → 终态通知注入）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `dogear__WaitForMessage` 工具注册实际在 `tools/delegation-tools.ts`（非 pi-session.ts，pi-session 仅经 createDelegationToolDefs 组装工具包）；已连同 handler、`expandWaitTargets`、`WAIT_FOR_MESSAGE_DESC`、`loadSettings`/`formatTerminalSummary` 失效 import 一并删除
  - unknown tool 容错已验证（无需占位工具）：pi-agent-core `agent-loop.js` `prepareToolCall` 对未注册工具名立即返回 `{ kind: 'immediate', result: createErrorToolResult("Tool xxx not found"), isError: true }`，经 `createToolResultMessage` 作为 tool_result 回给模型，循环正常继续；发生在 beforeToolCall 钩子之前，不会触发权限确认悬挂
  - `notifyTerminalToWaiters` 按 step1 接力棒改名 `notifyTerminalToParent` 并收口为纯注入
  - `abortWaitsForParent`（tipc abortWaitForDeliveries 的后端）不在删除清单但依赖 messageWaiters：剥离 waiter 循环后仅取消运行中子会话，返回形状从 `{ abortedWaits, cancelledChildren }` 收窄为 `{ cancelledChildren }`（渲染层无调用方，IPC 面安全）
  - 计划外必要同步：`task-queue.ts` 执行提示词含「必须用 dogear__WaitForMessage 挂起等待」——按全局 grep 清理要求改写为事件驱动语义（派单后结束回合、交付/终态注入唤醒、全部验收后才申报）
- 改动文件清单：`electron/main/agents/delegation-bridge.ts`、`delegation-terminal.ts`、`tools/delegation-tools.ts`、`session-append-templates.ts`、`pi-session/pi-session.ts`、`services/task-queue.ts`、`tipc/delegation.ts`、`delegation-test-mocks.ts`、`delegation-idle.test.ts`、`delegation-resume.test.ts`、`delegation-regression.test.ts`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 注入出口唯一化：`pushToParentSession(toConversationId, msg): boolean`（false ≡ target_inactive）；`deliverMessage(): 'queued' | 'target_inactive'`；`notifyTerminalToParent(c)` 仅在 settleTerminal 不重调分支调
  - `notifyTerminalToParent` 注入失败仅 logger.warn：主会话未打开（target_inactive）时终态事实靠 delivery 标记 + 共享区文件 + ListLinkedSessions 自愈，与设计文档一致
  - 测试 mock 升级：`delegation-test-mocks.ts` 现镜像真实 attach/detach 语义（retain/release 引用计数、detach 归零销毁 session 并摘除 conversation→session 绑定），新增 `registerParentSession(convId)`（建父会话绑定使注入可达）与 `waitForSend(sessionId, substr)`（轮询断言注入）；`getSessionIdByConversation` 不再恒 undefined
  - 注意：终态（含 no_delivery/hang）会走 detach → mock 中 session 被销毁；测试里 resume 后必须从 `sessions.get(snap.sessionId)` 取新引用再 emit complete
- 下个 step 该从哪里继续：Step 3（UI 等待中状态）：数据源用 childStates 快照派生「run settled ∧ 存在 running 直属子会话」；doc-sync 时同步清理 `docs/codebase-map.md` 的 WaitForMessage 工具清单/等待机制描述（本次未动，属 step3 范围）
- 待办或已知限制：
  - **task-queue 生命周期与新等待机制的交互待决策**：任务执行轮 = 一次 sendMessage，执行会话派单后结束回合时，队列会把任务兑底置为 review（通知「任务待审核」），后续注入唤醒的续跑轮在 review 态下运行且 ReportTaskResult 会被「无需重复申报」拦截。提示词已改为新语义（结束回合等待唤醒），但队列层面的「等待直属子会话再结算」需要后续 step 处理
  - 提示词过渡期兼容按主路径执行（工具已删，模型调旧工具名会收到 "Tool dogear__WaitForMessage not found" 工具错误，可自行适应）；无人值守环境未实测真实模型反应，若后续观察表现差可按设计文档预留方案补同名占位劝退工具
  - `docs/standards/*`（system-prompt-changes / tool-description-changes / skill-staged-execution-changes）仍含 WaitForMessage 旧文案，属历史改动清单记录，随 step3 doc-sync 一并定夺
