---
step: 1
title: Thinking 流事件转换
status: pending
---

## 目标

将 pi `message_update` 中的 `thinking_delta` 转换为既有 `ExtendedSessionMessage` 的 thinking 消息，使前端直接复用现有 thinking 合并和展示能力。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无。
- 当前关键文件状态：`electron/main/agents/pi-session/message-converter.ts` 的 `convertPiEvent(event)` 已转换 `tool_execution_start`、`tool_execution_end` 与 `message_update.text_delta`，其余事件返回 `null`。
- 关键决策回顾：只转换增量事件；`thinking_start` / `thinking_end` 不发消息，避免改变前端现有块合并和终态处理逻辑。

## 计划改动

- [ ] `electron/main/agents/pi-session/message-converter.ts`：在 `message_update` 分支中处理 `assistantMessageEvent.type === 'thinking_delta'`，返回 `{ type: 'thinking', content: delta, timestamp }`。
- [ ] `electron/main/agents/pi-session/message-converter.ts`：同步更新已过期的阶段性说明，准确描述 text 与 thinking 的转换范围。
- [ ] 执行与项目一致的类型检查或 lint，确认 pi 依赖中 `thinking_delta` 的 delta 字段可被 TypeScript 正确收窄。

## 验收标准

- pi 产生 `thinking_delta` 时，`PiSession.handleAgentEvent()` 经 `convertPiEvent()` 向现有 `message` 事件流发出 `type: 'thinking'` 消息。
- 非 thinking 增量、工具事件和错误路径的现有行为不变。
- 无需修改前端 thinking 组件、transformer 或 IPC。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
