---
step: 1
title: 申报消息与勾选卡渲染
status: done
---

## 目标
ReportTaskResult 与 TrackUserActions 摘出工具卡壳，渲染为消息流样式：申报消息（徽章+状态+markdown 正文+打开任务链接）与可勾选确认卡（勾选写背景 completed）。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 1 节
- 现状链路：tool_use 块 → ContentBlockItem.tsx case 'tool_use'（:77-89）→ ToolBlock → DOGEAR_CARD_RENDERERS['dogear__ReportTaskResult']=TaskResultRenderer / ['dogear__TrackUserActions']=TrackUserActionsRenderer（ToolBlock.tsx:168/170，分派 :546-550）
- 勾选现成链路：TrackUserActionsRenderer.tsx（toggle/localStorage key `user-action:{conversationId}:{toolUseId}`/失败回滚）→ client.appendStateUserEntry（tipc group.ts:222-233）→ background-store appendUserEntry（category:'completed'）
- ReportTaskResult 默认展开特例在 ToolBlock.tsx:580，本步摘壳后该特例随之失效需清理

## 计划改动
- [ ] ContentBlockItem.tsx tool_use 分支：canonicalName ∈ {dogear__ReportTaskResult, dogear__TrackUserActions} 时渲染新组件，不走 ToolBlock
- [ ] groupBlocks 合并逻辑：这两类 tool_use 排除出工具组（避免被组进 ToolGroupBlock）
- [ ] 新建 TaskReportMessage 组件：「任务申报」徽章 + 状态徽章（toolOutput 提取，沿用 TaskResultRenderer.tsx:22 的提取逻辑但需容错格式变化）+ result markdown 正文 + 「打开任务」链接（沿用 requestTaskFocus 链路）
- [ ] 抽 useUserActionChecklist hook（从 TrackUserActionsRenderer 抽 toggle/localStorage/回滚），新建消息式 UserActionsCard 组件挂 hook
- [ ] 清理 DOGEAR_CARD_RENDERERS 两项注册与 TaskResultRenderer（若无其他引用则删）
- [ ] 历史消息重载验证：旧会话里的申报/勾选 tool_use 块走新渲染

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无结构性差异。两处小裁量：① ContentBlockItem 里用 toolName 精确匹配两个名字（集合常量仅 groupBlocks 消费）；② 状态提取容错正则扩展（全/半角冒号、剥括号状态后缀、《标题》第二回退正则、八态状态映射），任一字段解析不出只省略对应元素
- 改动文件清单：
  - 新增 components/agent-chat/session-tools.ts（SESSION_MESSAGE_TOOL_NAMES）、TaskReportMessage.tsx、UserActionsCard.tsx、hooks/useUserActionChecklist.ts
  - 改 ContentBlockItem.tsx（tool_use 分发拦截）、MessageItem.tsx（groupBlocks flush 后单独 push）、ToolBlock.tsx（三表注册+buildResultAction 分支+defaultOpen 特例清理）
  - 删 tool-renderers/TaskResultRenderer.tsx、TrackUserActionsRenderer.tsx
- 验证：lint 0 errors；tsc --noEmit 渲染层零错误；历史重载与流式同走 case 'tool_use' 分发已确认（ToolBlock 仅 ContentBlockItem 一处引用）

### 给下一步的接力棒
- 关键签名 / 数据结构：`<TaskReportMessage toolInput toolOutput isError />`（running = toolOutput === undefined）；`<UserActionsCard toolInput toolUseId />`（useUserActionChecklist 抽自原渲染器，localStorage/回滚链路不变）；`extractReportMeta(outputText) → { taskId, taskTitle, status }` 模块级私有
- 下个 step 该从哪里继续：SendMessage 摘壳照抄本模式——新组件放 components/agent-chat/，ContentBlockItem case 'tool_use' 加分支，SESSION_MESSAGE_TOOL_NAMES 加 'dogear__SendMessage'（groupBlocks 排除自动生效），ToolBlock 三表清理。注意分发分支用 toolName 精确匹配不走 normalizeToolName
- 待办或已知限制：readOnly 会话勾选卡仍可点（与旧行为一致）；UserActionsCard 空 actions 显示占位行
