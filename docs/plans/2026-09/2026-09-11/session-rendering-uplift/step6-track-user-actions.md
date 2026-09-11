---
step: 6
title: TrackUserActions 勾选卡 + TopicQuickEntry 退役
status: pending
---

## 目标

新 agent 工具 `dogear__TrackUserActions`：提议用户本人要做的事 → 会话流渲染可勾选卡片 → 勾选写话题状态卡 completed；删除 TopicQuickEntry。

## 依赖上下文（接力棒输入）

- 设计文档 #8 节
- 当前关键文件状态：
  - `electron/main/agents/tools/group-tools.ts`：dogear-group server 注册模式（`registerToolGroup({ server, label, create, placeholder })`），create 签实施时以现状为准（闭包注入 workspaceId/groupId 类参数）
  - `electron/main/agents/pi-session/pi-session.ts` 组装处：dogear-group 工具包挂载点（主会话 && groupId 时，对齐 notes 工具挂载策略——实施时看现状条件）
  - 前端写状态卡入口：`client.appendStateUserEntry({ workspaceId, groupId, category: 'completed', text })`（TopicQuickEntry.tsx 在用，可直接照抄调用与错误 toast）
  - `components/ToolBlock.tsx`：`CardRendererProps { toolInput, toolOutput, isError }`——本步加 `toolUseId?: string`
  - `components/agent-chat/ContentBlockItem.tsx`：ToolBlock 调用处（tool_use case 尾部）透传 `block.toolUseId`
- 关键决策回顾：handler 只回执不落库；勾选态 localStorage `user-action:{conversationId}:{toolUseId}` = 已勾 index 数组 JSON；勾选不注入消息不打断会话

## 计划改动

- [ ] `group-tools.ts`：`dogear__TrackUserActions` defineTool——schema `z.object({ actions: z.array(z.string().min(1)).min(1).max(10) })`；description 按 plan.md 全局决策口径（必须用户本人完成 + 需跟踪时调用；用户勾选后自动记入状态卡「已完成」，无需等待回复）；handler 校验 groupId 存在后回执文案（提示 agent 已渲染勾选卡、无需重复调用）；groupId 缺失返回 isError 提示
- [ ] `pi-session.ts` 组装处：确认挂载条件（主会话 && groupId）并把工具加入 dogear-group 包
- [ ] `ToolBlock.tsx`：CardRendererProps 加 `toolUseId?: string`；ContentBlockItem 调用处透传；注册 `dogear__TrackUserActions`（图标 CircleCheckBig、标题「待你完成 · N 项」、RENDERERS 挂新渲染器）
- [ ] 新 `tool-renderers/TrackUserActionsRenderer.tsx`：
  - props 从 toolInput.actions 渲染行列表：Checkbox（shadcn）+ 文本
  - 勾选回调：置本地勾选态 → `client.appendStateUserEntry({ category: 'completed', text: 原文 })` 成功后写 localStorage（失败 toast + 回滚勾选态）
  - 挂载时读 localStorage 恢复已勾行（划线/变灰）
  - conversationId 来源：`useConversationId()`（conversation-id-context，MessageItem 子树已有 Provider）
- [ ] 删除 `components/agent-chat/TopicQuickEntry.tsx`；`ChatInputArea.tsx` 清理 import 与 `{groupId && <TopicQuickEntry/>}` 区块及不再使用的 groupId prop 链（AgentChat 传参处一并清理，若 groupId 无其他消费者）
- [ ] 提示词侧：`session-append-templates.ts` 若有涉及「这事做完了/记一笔」的指引文案（NOTES_GUIDANCE 附近）同步更新为 TrackUserActions 语义——搜索确认，无则跳过

## 验证

- 会话中让 agent「提议两件我要做的事」→ agent 调工具 → 勾选卡出现；勾一条 → 话题面板状态卡 completed 区新增该条；刷新会话勾选态保留
- 再勾同一条不重复（localStorage 已勾跳过）；断网/失败时勾选回滚 + toast
- 输入框旁「这事做完了/记一笔」按钮消失，无残留 import 报错；`bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
