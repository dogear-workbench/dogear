---
step: 1
title: PiSession 状态与终态模型
status: pending
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
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
