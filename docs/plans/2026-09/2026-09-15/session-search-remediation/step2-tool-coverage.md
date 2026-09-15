---
step: 2
title: tool 块搜索覆盖与折叠联动
status: pending
---

## 目标

tool_use 块（工具名/输入/输出）纳入搜索，命中时自动展开折叠卡片、卡片高亮并滚动定位。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-hit-model.md] SearchMatch 已改块内命中编号；MessageItem 已传原始 blockIndex 并挂 data-block-index
- 现有折叠结构：ToolGroupBlock 用 CollapsibleBlock（默认收起，Radix CollapsibleContent 关闭时不渲染子节点，CollapsibleBlock.tsx:43-45）；InjectedMessageCard 默认收起（MessageItem.tsx:57-115）
- tool_use 块数据：toolName / toolInput(对象) / toolOutput 都在内存消息的 contentBlocks 上（调研报告 §1）
- 展开时序参考：AgentChat 折叠段「setCollapsed(false) → rAF → scrollToMessage」先例（AgentChat.tsx:343-357）

## 计划改动

- [ ] `components/agent-chat/hooks/useMessageSearch.ts`：扫描 tool_use 块三子域（toolName / JSON.stringify(toolInput) / toolOutput 文本），按此顺序拼接为单域编号（plan.md 全局决策）
- [ ] `components/agent-chat/ToolGroupBlock.tsx` + `tool-renderers/*`：tool 块命中高亮方案——命中该块时卡片容器加高亮样式（border/bg），不做域内 mark
- [ ] 折叠联动：activeMatch 落在收起的 CollapsibleBlock / InjectedMessageCard 内时先展开（store 状态）→ rAF → 滚动到卡片（复用 Step 1 的块级 fallback 通道）
- [ ] 确认 toolOutput 是否有截断存储；截断则命中编号只对已展示部分计算，并在回填中记录

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
