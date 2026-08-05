---
step: 1
title: PiSession 状态与终态模型
status: done
---

## 目标

让 PiSession 从 prompt 开始到 Harness settled 都发布正确运行态，并为每一轮产生可供上层判定的唯一成功或失败终态。

## 依赖上下文（接力棒输入）

- 设计依据：`../subsession-lifecycle-observability-design.md` 已确定 `PiSession` 是运行和终态的唯一事实来源。
- 当前 `sendMessage()` 在 `electron/main/agents/pi-session/pi-session.ts:548` 设置 `running=true`，但直到 `:568` 才调用 `syncSessionState()`；正常快速任务可能从未向前端发出 `running=true`。
- 当前 `agent_end.stopReason='error'` 在 `:387` 仅 emit 普通 `message`，而 `sendMessage()` 随后于 `:553` emit success complete，导致上层无法可靠区分模型错误。
- `getLiveSnapshot()` 与 `conversation-runtime-service.attachConversation()` 已具备进行中消息/权限回放基础，见 `pi-session.ts:171`、`conversation-runtime-service.ts:116`。

## 计划改动

- [ ] 为 PiSession 定义明确的轮次终态类型，至少区分 `success`、`failed`、`cancelled`，并携带稳定的错误文本或失败类别。
- [ ] 在非插话路径设置 `running=true` 后立即调用 `syncSessionState()`，保证网络请求开始前发出运行事件；保持 settled 后的 `running=false` 结算。
- [ ] 统一 `message_update` 错误、`agent_end.stopReason='error'`、`adapter.prompt()` 抛错和中断路径，让它们既能向聊天流呈现错误，也能写入本轮结构化失败结果。
- [ ] 仅在本轮没有失败结果时发布成功 complete；失败结果必须由上层可识别，不能再被 success complete 覆盖。
- [ ] 审查 `liveTurnMessages` 的生命周期，保证运行中 attach 能回放，结算后依赖持久历史读取且不重复播放。
- [ ] 更新 `pi-session-manager.ts` 和 `tipc/agent.ts` 所需事件类型，保持所有 Renderer 广播仍经 tipc handlers。

## 实施回填（做完后填）

### 实际改动
- PiSession 在 `adapter.prompt()` 前立即同步 `running=true`，结算后仍由 Harness settled 回调发布 `running=false`。
- 新增 `PiSessionTurnResult`，将模型流错误、`agent_end` 错误、运行时抛错和用户中断统一为 `success`、`failed`、`cancelled` 三类终态；错误仍作为消息流事件送往聊天页。
- `complete` 仅在 prompt 已返回（Harness 已结算）后发布结构化终态，PiSessionManager 和 tipc 广播路径已使用该类型。
- 与计划差异：未改 bridge 的 child 分类和前端呈现，留在 Step 2 按计划处理。
- 改动文件清单：
  - `electron/main/agents/pi-session/pi-session.ts`
  - `electron/main/agents/pi-session/pi-session-manager.ts`
  - `electron/main/tipc/agent.ts`

### 给下一步的接力棒
- 关键签名 / 数据结构：`PiSessionTurnResult = { subtype: 'success' | 'failed' | 'cancelled'; error?: { kind; message } }`；`complete` 事件始终在安全结算后发送。
- 下个 step 该从哪里继续：让 `delegation-bridge.ts` 的 `wireSession` 读取 complete 结果，并按 subtype 设置 child status，再安全 detach attachment。
- 待办或已知限制：当前 bridge 仍把所有 complete 视为 `no_delivery`，因此必须执行 Step 2 后子会话失败才会在界面正确分类。
