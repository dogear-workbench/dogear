---
step: 6
title: TrackUserActions 勾选卡 + TopicQuickEntry 退役
status: done
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
  - 挂载条件：现状 dogear-group 包在主/子会话均为 `if (groupId)` 挂载（子会话固定挂载是交付基础设施），工具加入包返回数组后自动跟随包逻辑，pi-session.ts 零改动；子会话（有 groupId 时）也可提议勾选卡，前端渲染链路通用无副作用。与设计文档 #8「主会话 && groupId」字面偏差，取 plan.md 全局决策「挂 dogear-group server（groupId 闭包注入，空则不注册）」的字面实现。
  - 提示词侧确认：session-append-templates.ts 全文无 TopicQuickEntry /「这事做完了」相关指引（NOTES_DISCIPLINE 里的「记一笔」是任务语境），按 step 约定跳过。
  - 图标色系选 emerald（完成语义；blue 系已属任务组避免混淆）。
- 改动文件清单：
  - `electron/main/agents/tools/group-tools.ts:59-81`：新 defineTool `dogear__TrackUserActions`（schema `actions: string[] 1~10`；handler 校验 groupId 后回执「已渲染勾选卡 / 无需重复调用」，groupId 缺失返回 isError）
  - `components/ToolBlock.tsx`：:32 import 渲染器、:50 ToolBlockProps 加 toolUseId、:91 DOGEAR_TOOL_ICONS（CircleCheckBig emerald）、:107 CardRendererProps 加 toolUseId、:152-155 卡片标题「待你完成 · N 项」、:170 RENDERERS 注册、:508 解构、:552 DogearCard 透传 toolUseId
  - `components/agent-chat/ContentBlockItem.tsx:215`：ToolBlock 透传 `block.toolUseId`
  - `components/agent-chat/tool-renderers/TrackUserActionsRenderer.tsx`（新，126 行）：勾选卡渲染器
  - `components/agent-chat/TopicQuickEntry.tsx`：删除
  - `components/agent-chat/ChatInputArea.tsx`：删 import / props groupId 字段与解构 / `{groupId && <TopicQuickEntry/>}` 区块；Step 5 芯片区块未受影响
  - `components/agent-chat/AgentChat.tsx:640`：删 `groupId={currentConversation?.groupId || null}` 传参

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - localStorage key `user-action:{conversationId}:{toolUseId}` = 已勾 index 升序 JSON 数组；读取容错（非法 JSON / 非数字元素丢弃、去重排序）
  - 渲染器上下文三源：`useConversationId()`（conversation-id-context）、`useWorkspaceId()`（workspace-id-context）、groupId 从 `useConversationStore` 窄选择器按 conversationId 查 `conversations.find(...)?.groupId`（ToolBlock CreateSession 分支同源）
  - 勾选链路：乐观置勾 → `client.appendStateUserEntry({workspaceId, groupId, category: 'completed', text})` → 成功才写 localStorage；`r.error` / 异常均 toast + 回滚；已勾项 disabled 防重复
  - CardRendererProps 现有四字段：toolInput / toolOutput / toolUseId / isError（后续渲染器需要 toolUseId 时直接用）
- 下个 step 该从哪里继续：plan.md 的 Step 7（如有）；本计划剩余人工验证项见下
- 待办或已知限制：
  - 运行时人工验证未做（需真实会话流）：① agent 调工具 → 勾选卡出现 → 勾选 → 话题面板 completed 新增 → 刷新保留；② 重复勾选不重写；③ 断网回滚 + toast；④ 输入框旁按钮消失无残留报错
  - localStorage 与状态卡可能不一致（清 localStorage 后重勾会重复写 completed 条目），设计文档 #8 错误处理段已接受此残留风险
