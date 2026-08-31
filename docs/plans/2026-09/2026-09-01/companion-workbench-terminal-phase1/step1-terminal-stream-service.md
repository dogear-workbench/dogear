---
step: 1
title: 主进程终端流服务
status: done
---

## 目标
pi-session 将 bash 工具的流式更新分流到新 terminal-stream 服务；服务按会话环形缓冲、向所有窗口广播增量、提供历史查询 RPC。

## 依赖上下文（接力棒输入）
- 勘查结论：pi-agent-core `bash.js` 的 `execute` 第 4 参 `onUpdate(partialResult)` 在输出 chunk 到达时经 100ms 节流触发，`partialResult.content[0].text` 是**累积输出快照**；agent-loop `executePreparedToolCall` 将其包装为 `{ type: 'tool_execution_update', toolCallId, toolName, args, partialResult }` AgentEvent
- `electron/main/agents/pi-session/pi-harness-adapter.ts:71` `onAgentEvent: (event: AgentEvent) => void` 已把该事件透传给 pi-session.ts（FORWARDED_EVENTS 含 `tool_execution_update`）
- pi-session.ts 现有 onAgentEvent 处理入口：搜 `onAgentEvent` / 事件分发函数，分流点加在这里；该处能拿到本会话 conversationId
- tipc 路由注册模式参考 `electron/main/tipc/` 现有文件（如 windows.ts）；渲染端广播参考既有 `broadcastSettingsChanged` / `categoriesUpdated` 的实现位置（renderer-handlers 或 index.ts）

## 计划改动
- [x] 新建 `electron/main/services/terminal-stream-service.ts`：`Map<conversationId, TerminalEntry[]>` 缓冲；`handleToolUpdate(conversationId, toolCallId, command, snapshotText)` 做前缀 diff（append/replace 判定）+ 更新缓冲 + 广播 `terminal-stream:append`；`handleToolStart(conversationId, toolCallId, command)`（tool_execution_start 时建 entry，exitCode 由 update/end 补）；`getBuffer(conversationId)`；`clearConversation(conversationId)`
- [x] pi-session.ts 事件分发处分流：`tool_execution_start`（toolName==='bash'，记 command）、`tool_execution_update`（toolName==='bash'，传累积快照）、`tool_execution_end`（补结束态）；不改变现有事件转发行为
- [x] pi-session 销毁链路（destroy/session close）调 `clearConversation`
- [x] 新建 `electron/main/tipc/terminal.ts`：`getTerminalBuffer(conversationId)` 路由；在 tipc 入口注册
- [x] 广播：向所有窗口发送（参考既有广播工具函数；若无则 window-manager/webContents 遍历）

## 验证
- 起主会话让 agent 跑几条命令（含多行输出、颜色输出如 `git log`、`ls --color`），在主进程日志打印广播 payload：增量 append 正常、replace 兜底正常
- `getTerminalBuffer` 手动调用返回累积条目；关会话后缓冲清空
- 长 output 命令（如 `bun run build`）观察节流下事件频率合理（~10/s 以内）、无内存异常增长

## 实施回填（做完后填）

### 实际改动
- 与计划差异：广播不走裸 `webContents.send('terminal-stream:append')`，而是走项目统一收口 `broadcastToWindows` + tipc renderer-handlers，事件名为 `terminalStreamAppend`（camelCase 函数名即 tipc 通道名，tipc 事件名不支持冒号）；payload 的 `type` 除 append/replace 外增加 start/end（渲染端建卡片需要 command/startedAt，补终态需要 exitCode）
- 改动文件清单：
  - `electron/main/services/terminal-stream-service.ts`（新建）：按会话缓冲（200 条命令 / 单命令 text 256K 字符保尾部）、前缀 diff 增量协议、广播、`getTerminalBuffer` / `clearConversation`
  - `electron/main/agents/pi-session/pi-session.ts`：`handleAgentEvent` 入口新增 `forwardBashTerminalEvent` 旁路（start/update/end、toolName==='bash'）；`doClose()` 收尾时清缓冲
  - `electron/main/tipc/terminal.ts`（新建）：`getTerminalBuffer` 路由，已在 `tipc/index.ts` 注册
  - `electron/main/tipc/renderer-handlers.ts`：新增 `terminalStreamAppend` 事件类型

### 给下一步的接力棒
- 关键签名 / 数据结构：见 `terminal-stream-service.ts` 顶部 `TerminalEntry` / `TerminalStreamEvent`；RPC `getTerminalBuffer({ conversationId }) => TerminalEntry[]`
- 下个 step 该从哪里继续：渲染端订阅 renderer-handlers 的 `terminalStreamAppend` + 挂载时调 `getTerminalBuffer`
- 待办或已知限制：exitCode 仅成功(0)/错误文本反解两种来源，abort/timeout 场景为 undefined（pi-agent-core bash 工具不透出 exitCode）；text 上限按字符数计；详见共享区 step1-delivery.md
