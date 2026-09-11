---
step: 1
title: 主进程注入事件广播 + sender tag schema
status: done
---

## 目标

注入父/执行会话的 user 消息（子会话交付/回复/终态/resume、task-execution、failover 续跑提示）在落盘时向前端广播**带内容与 tag 的 user 事件**，前端无需改动即可先收到事件（本步只管广播）。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-09/2026-09-11/session-rendering-uplift-design.md` #1 架构节
- 当前关键文件状态：
  - `electron/main/agents/pi-session/pi-session.ts` 约 691 行：`message_end` 分支已按 role 广播 `message_id`（uuid），user 消息只有 uuid 事件没有内容事件
  - `electron/main/agents/pi-session/message-converter.ts` `convertPiEvent` 只转 assistant 侧事件，本步**不改它**（user 注入事件在 pi-session.ts 广播，不走 converter）
  - `electron/main/agents/delegation-bridge.ts:790` `pushToParentSession` → `session.sendMessage(text)`；`:830` `buildSenderTag(fromSessionId, fromLabel, delivery)` 生成 `<sender kind="agent" .../>`
- 关键决策回顾：tag 由**调用方显式传入**而非文案猜测；未传 tag 的 sendMessage（UI 正常发送、skill 注入）不进 pendingInjected 队列、不广播内容事件

## 计划改动

- [ ] `pi-session.ts`：`sendMessage(text, opts?: { injectionTag?: InjectionTag })` 加可选参数（含 `steer` 场景透传与否的确认——steer 排队时 tag 同样要记）；内部维护 `pendingInjected: Array<{ text, tag }>` 队列（sendMessage 打 tag 时入队）
- [ ] `pi-session.ts` message_end 分支：`role === 'user'` 时按 content 与队首匹配出队，命中则构造 `ExtendedSessionMessage { type: 'user', content, injectedTag, timestamp, role: 'user' }`，走既有 `this.emit('message', ...)` 与 `liveTurnMessages.push`（与 message_id 并行）
- [ ] `delegation-bridge.ts`：`buildSenderTag` 加 `tag` 属性（delivery / reply / terminal / resume 四值；`pushToParentSession` 的 msg 结构加 `tag` 字段，`deliverMessage` / `notifyTerminalToParent` / `resumeChildAndDeliver` / `resumeParentAndDeliver` 各调用点按语义传）；`sendMessage` 调用点传 `injectionTag`
- [ ] `delegation-terminal.ts` `buildTerminalNotice`：文案前 sender 标签带 `tag="terminal"`（若 tag 由 bridge 侧拼接则改对应传参）
- [ ] `delegation-resume.ts` `buildResumePrompt`：sender 标签 `tag="resume"`
- [ ] `services/task-queue.ts` `buildExecutionPrompt`（约 :96）：sendMessage 调用处传 `injectionTag: 'task-execution'`（runExecutionTurn 内 `session.sendMessage(buildExecutionPrompt(task))`）
- [ ] `agents/model-failover.ts`：failover 续跑提示的 sendMessage 传 `injectionTag: 'failover'`
- [ ] 类型：`InjectionTag` 类型定义放 pi-session.ts 或 task-types.ts 导出；ExtendedSessionMessage 加 `injectedTag?: string`
- [ ] 兼容性确认：`transcript-adapter.ts` / `history-adapter.ts` / 状态卡抽取（STATE_EXTRACT transcript-cleaner）按行剥离 user 消息，sender 加属性不影响——确认这些消费方不解析 sender 属性白名单

## 验证

- `bun run build:electron` 通过
- dev 起应用：主会话派一个子会话（任意任务），子会话交付后：在渲染进程 console 或主进程日志确认发出了 `{ type: 'user', content: '<sender...', injectedTag: 'delivery' }` 事件（前端此时仍不渲染，正常）
- 回归：正常对话（用户手打消息）不产生新增 user 内容事件（只有既有 message_id）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `delegation-terminal.ts` / `delegation-resume.ts` 零改动——sender 标签由 bridge 侧拼接，tag 经 `notifyTerminalToParent` 的 `msg.tag='terminal'` 与 `resumeChild` 的 wakeTag='resume' 落地（step 允许分支）
  - delegation-tools.ts 零改动：bridge 层 `msg.tag ?? deliveryToTag(delivery)` 统一推导，delivery 布尔自动映射 delivery/reply
  - 计划外补充：`interrupt()` / `doClose()` 清空 pendingInjected（harness abort 清 steer 队列后残留项永无匹配时机，会卡死队首匹配）
  - `injectedTag` 用 `InjectionTag` 类型而非 string（更严格，兼容意图）
- 改动文件清单：`task-types.ts`（InjectionTag + injectedTag）、`pi-session.ts`（sendMessage opts / pendingInjected / tryFlushPendingInjected / interrupt+close 清空）、`delegation-bridge.ts`（DeliverMessageOptions.tag / buildSenderTag 第4参 / deliveryToTag / resumeChild.wakeupTag / 全链路传 tag）、`task-queue.ts:280`（task-execution）、`model-failover.ts:142`（failover）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `sendMessage(content, opts?: { injectionTag?: InjectionTag })`；message_end(user) 命中队首时广播 `{ type:'user', content: string, injectedTag, timestamp, role:'user' }`（同一 user message_end 先 message_id 后内容事件）
  - sender 标签 schema：`<sender kind="agent" session_id="..." name="..." delivery="true|false" tag="delivery|reply|terminal|resume"/>`；task-execution/failover 不带 sender 标签
- 下个 step 该从哪里继续：streamReducer 加 `type:'user'` + injectedTag 分支；`isInjectedUserMessage(content)` 兜底旧历史（delivery="true"→绿，含「终止/失败/耗尽/quota」→红，兜底蓝）
- 待办或已知限制：
  - startChild 的 `spec.task`（子会话首条任务消息）未打 tag——新建会话首轮有独立展示路径，Step 2 实施时若发现需要再加
  - 不打 tag 维持现状的调用点：delegation-bridge:563（startChild）、tipc/agent.ts:239/241（UI 发送）、tipc/browser.ts:90（browser 唤醒）
  - dev GUI 人工验证（派子会话确认注入事件、正常对话回归）未做，需用户日常使用时回归
