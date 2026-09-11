---
step: 7
title: 死代码清理（旧 SDK hook 事件）
status: done
---

## 目标

删除 pi 会话不再产生的旧 SDK 时代渲染分支与聚合器，减小代码面。

## 依赖上下文（接力棒输入）

- 设计文档附录「内容块级」清单
- 前置 step 产出：Step 1-6 全部完成且人工验证通过（本步在前面的新渲染稳定后做，避免误删仍被引用的路径）
- 当前关键文件状态（待删清单）：
  - `components/agent-chat/ContentBlockItem.tsx`：`session_start` / `session_end` / `stop` / `tool_failure` / `notification` / `task_notification` / `local_command_output` / `user`（重放）八个 case；`TodoWrite` / `TaskList` / `TaskCreate` / `TaskUpdate` 四个 tool_use 特判
  - `components/agent-chat/task-aggregator.ts`（整文件）、`TodoListBlock.tsx`（整文件）、`AgentChat.tsx` 内 aggregateTasks 的吸附渲染消费点
  - `components/agent-chat/transformers.ts` `createContentBlock` 的 hook 字段透传（sessionStartSource 等，类型删则透传同步删）
  - `components/agent-chat/types.ts` ContentBlock 联合类型中对应 type 与字段
- **保留清单**（pi 仍产生，勿删）：text / thinking / tool_use / tool_result / tool_group（前端虚拟）/ permission_request / ask_user_question / compact_boundary / compacting / error / result / message_id

## 计划改动

- [ ] 验证前置：grep `electron/main` 确认无任何代码产生上述待删事件 type（pi-session / message-converter / tipc/agent.ts broadcaster 全面查 `session_start|session_end|tool_failure|task_notification|local_command_output|TodoWrite|TaskList|TaskCreate|TaskUpdate`）
- [ ] `ContentBlockItem.tsx`：删八个 case + 四个特判（ContentBlockItem 的 switch 直接落到 default 的 MarkdownRenderer 不可能——删 case 后类型收窄，TS 编译器会兜底检查遗漏）
- [ ] 删 `task-aggregator.ts`、`TodoListBlock.tsx`；`AgentChat.tsx` 清理 aggregateTasks 消费与相关 state/渲染
- [ ] `types.ts`：ContentBlock 联合删 `session_start|session_end|stop|tool_failure|notification|task_notification|local_command_output` 类型及 hook 字段（sessionStartSource / sessionEndReason / stopHookActive / failedToolName / failedToolError / notificationTitle / notificationMessage / notificationType / taskId / taskStatus / taskSummary）；`transformers.ts` createContentBlock 同步删透传
- [ ] `MessageMinimap.tsx` / `StableHistory.tsx` / `LiveTail.tsx` 等消费方 grep 清理引用
- [ ] `bun run lint` + `bun run build`（前端 + electron）通过

## 验证

- lint / build 零报错；现有会话（含旧历史）打开渲染无回归——注意：旧 SDK 历史会话已归档不回放（`.dogear/conversations/`），若仍有 pi 前历史 JSONL 被读到，未识别 type 走 default 分支渲染原文，可接受
- 小地图 / 搜索 / 分叉等跨模块功能冒烟

## 实施回填（做完后填）

### 实际改动
- 验证前置结论：grep electron/main 全目录零产生点（pi 链路实际只产生 text/thinking/tool_use/tool_result/message_id/user/error/compacting/compact_boundary；transcript-adapter 的 TaskCreate/TaskUpdate 是 TOOL_KEY 映射、agent-worker 的 taskUpdate 是 WorkerToMainMessage，均非渲染事件）
- 与计划差异：
  - LiveTail/StableHistory 删 TodoListBlock 后 Fragment 退化为单子元素，顺手简化为直接 key 的 MessageItem（等价重构）
  - useTranscriptState blockFingerprint 删 Task 特判（属「消费方 grep 清理」范畴，服务对象 aggregateTasks 已删）
  - ContentBlock 联合中 user/status 按保留清单保留（user 仅删渲染 case，残留 block 落 default 渲染原文）
  - 主进程 task-types.ts 的 hook 类型未动（step 范围为前端渲染层，见遗留）
- 改动文件清单：`ContentBlockItem.tsx`（删 8 case + 4 特判）、删 `task-aggregator.ts`（-91）与 `TodoListBlock.tsx`（-44）、`AgentChat.tsx`（删 aggregateTasks 消费链 4 useMemo + props）、`types.ts`（联合删 7 type + 11 hook 字段）、`transformers.ts`（createContentBlock 透传同步删）、`LiveTail.tsx` / `StableHistory.tsx`（删吸附渲染与 props）、`useTranscriptState.ts`（blockFingerprint 特判删）

### 给下一步的接力棒
- 关键签名 / 数据结构：ContentBlock 联合现存 type = text / tool_use / tool_result / thinking / status / error / result / user / permission_request / ask_user_question / compact_boundary / compacting / tool_group（前端虚拟）
- 下个 step 该从哪里继续：本 step 是最后一步，无后续
- 待办或已知限制：
  - 主进程 task-types.ts 的 ExtendedSessionMessage 仍保留 7 hook 类型成员与 11 hook 字段（无产生点、前端已不消费），建议后续主进程清理时一并删
  - GUI 冒烟（会话渲染/小地图/搜索/分叉）待用户回归
