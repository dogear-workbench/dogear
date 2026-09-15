---
step: 2
title: tool 块搜索覆盖与折叠联动
status: done
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
  - tool-renderers/* 未逐个改：所有 tool 卡容器统一是 ToolBlock 持有的 CollapsibleBlock，容器层高亮/展开自动覆盖全部 renderer 分支
  - 折叠联动用受控 forceOpen 而非 store/rAF：命中随 activeMatch 声明式展开，与 AgentChat 的 jumpToActiveMatch effect 同一 commit 生效
  - 组卡（ToolGroupBlock）只展开不高亮：视觉焦点在具体命中子卡；子卡高亮经 ContentBlockItem→ToolBlock 链路自动生效
  - 特判卡（AgentCommCard/TaskReport/UserActions/SendMessage/CreateSession）未接卡片高亮/展开，靠块级 DOM + 消息级 flash 兜底，不会零反馈
- 改动文件清单：components/agent-chat/hooks/useMessageSearch.ts（tool_use 三子域 `[toolName, serializeToolField(toolInput), serializeToolField(toolOutput)].join('\n')` 单域扫描 + 抽 scanText 统一四处循环）、components/agent-chat/highlight.ts（serializeToolField / isBlockActive）、components/agent-chat/CollapsibleBlock.tsx（forceOpen + highlighted props）、components/agent-chat/ContentBlockItem.tsx（tool_use 分支算 searchHit 传 ToolBlock）、components/ToolBlock.tsx（searchHit → forceOpen+highlighted）、components/agent-chat/ToolGroupBlock.tsx（groupHit → 组卡 forceOpen）、components/agent-chat/ThinkingBlock.tsx（命中 forceOpen，顺带解决 Step 1 遗留 compact 收起无 mark 问题）、components/agent-chat/MessageItem.tsx（InjectedMessageCard 命中 user 域 `${mid}--1-` 自动展开）
- toolOutput 截断结论：存储与展示均无截断（history-adapter/message-converter 的 extractToolResultText 完整 join；OutputBox 全量渲染；FileChangeRenderer diff 超 500 行回退整块展示无丢失）——无需降级处理
- 验证：bun run lint 0 errors（83 warnings 既有）、tsc --noEmit 全绿；未改 electron/

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `serializeToolField(value): string`（string 原样/对象 JSON.stringify(v,null,2)）、`isBlockActive(activeMatchId, messageId, blockIndex): boolean`（highlight.ts，可复用）
  - CollapsibleBlock 新 props：`forceOpen`（open = isOpen || forceOpen）、`highlighted`（outline+浅底色）
  - 搜索扫描入口集中在 useMessageSearch 的 scanText；Step 3 路径管道不触碰搜索链路，互不干扰
- 下个 step 该从哪里继续：Step 3 路径补全与存在性校验管道，从 path-link.tsx / workspace-fs-service.ts / tipc explorer 组入手
- 待办或已知限制：
  - 特判卡命中无卡片高亮/自动展开，仅块级滚动 + 消息级 flash 兜底
  - activeMatch 切走后 forceOpen 撤销、卡片回回收起态（受控方案固有行为）
  - toolInput 搜索端 JSON 序列化与 KeyValueList 展示端 string 值无引号有细微口径差，仅 query 含 JSON 语法字符时影响，tool 块无域内 mark 故无功能影响
