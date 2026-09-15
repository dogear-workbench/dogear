---
step: 1
title: 命中模型重构与高亮定位修复
status: done
---

## 目标

SearchMatch 改为块内命中编号模型，user/text/thinking 三域高亮渲染与跳转定位准确可靠，消灭「跳不过去、零反馈」。

## 依赖上下文（接力棒输入）

- 背景根因（调研报告 §3）：搜索端 offset 按 block.content 全文、渲染端 highlightText 按 markdown 段落 child 内部重算（MarkdownRenderer.tsx:22-37 + highlight.ts:21 + AgentChat.tsx:337），两套口径必错位；ThinkingBlock（ContentBlockItem.tsx:234）完全不接高亮；tool_group 分组（MessageItem.tsx:157-196, 472-486 + ToolGroupBlock.tsx:92-93）使渲染 blockIndex 与原始索引错开
- 现有跳转：AgentChat.tsx:334-357 querySelector + scrollToElement(top-third)，命中折叠段 setCollapsed(false) + rAF scrollToMessage
- 用户消息渲染：MessageItem.tsx:397-403 line-clamp-2 + isStickyExpanded

## 计划改动

- [ ] `components/agent-chat/hooks/useMessageSearch.ts`：SearchMatch 改 `{id, messageId, blockIndex, hitIndexInBlock}`；id 按 plan.md 全局决策格式；user/text/thinking 三域扫描逻辑保持，去掉 textStart/textEnd
- [ ] `components/agent-chat/highlight.ts`：改为「域内 query 全量 indexOf + 按序编号」生成 mark，废弃全局 offset 对接；保留 baseId 前缀约定
- [ ] `components/agent-chat/MarkdownRenderer.tsx`：wrapChildren 从 p/li 扩到标题/代码块/表格/strong/em（22-37、133-139 两处）；每个 string child 用域内编号连续累进（同一块跨多个段落时编号不断裂——块级计数器贯穿整块渲染）
- [ ] `components/agent-chat/ContentBlockItem.tsx`：thinking 分支接 searchQuery/activeMatchId，ThinkingBlock 渲染时同样块内编号高亮
- [ ] `components/agent-chat/MessageItem.tsx`：渲染循环传出原始 contentBlocks 索引（分组结构保留子块原始索引映射，供 Step 2 tool 块复用）；块级 DOM 挂 `data-block-index`；用户消息命中 activeMatch 时 setIsStickyExpanded(true)
- [ ] `components/agent-chat/AgentChat.tsx`：跳转改三级 fallback（mark → `[data-block-index]` → scrollToMessage + flash）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 计划 6 文件之外额外改了 ThinkingBlock.tsx（第 4 条“ThinkingBlock 渲染时同样块内编号高亮”的实现落点）与 ToolGroupBlock.tsx（消费子块原始索引映射，移除 `blockIndex * 100 + idx` 第三套口径——分组内 thinking 子块的高亮 id 本 step 就需对齐，且为 Step 2 tool 块直接铺路）
  - user 域 match id 由旧 `${messageId}-u-N` 统一为全局决策格式 `${messageId}--1-N`（blockIndex=-1）；content 域同理 `${messageId}--2-N`
  - 块级 fallback 的块级 DOM 用 MessageItem 渲染循环中的包衰 div（data-block-index=原始索引）实现，不侵入 ContentBlockItem 各分支；极罕见的渲染为 null 的块（result 等）会产生一个高度为 0 的空 div，space-y 下多 8px 间距，影响可忽略
  - MarkdownRenderer 编号器经 numberingRef（每次渲染重置）中转进 memoized mdComponents，保持 components 引用稳定不被破坏
- 改动文件清单：components/agent-chat/hooks/useMessageSearch.ts、components/agent-chat/highlight.ts、components/MarkdownRenderer.tsx、components/agent-chat/ThinkingBlock.tsx、components/agent-chat/ContentBlockItem.tsx、components/agent-chat/ToolGroupBlock.tsx、components/agent-chat/MessageItem.tsx、components/agent-chat/AgentChat.tsx
- 验证：`bun run lint` 0 errors（83 warnings 均为未触碰文件的既有 no-explicit-any）、`npx tsc -p tsconfig.json --noEmit` 全绿

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SearchMatch { id, messageId, blockIndex, hitIndexInBlock }`，id = `${messageId}-${blockIndex}-${hitIndexInBlock}`（blockIndex -1=user 正文、-2=AI content、>=0=原始 contentBlocks 索引）
  - `highlightText(text, query, baseId, activeMatchId, numbering?)`，`createMatchNumbering()` 产出块级计数器；match id = `${baseId}-${counter.take()}`
  - `groupBlocks()` 返回 `RenderBlockEntry { block, originalIndex, childOriginalIndices? }`；ToolGroupBlock 接 `childOriginalIndices` 并用 `childOriginalIndices?.[idx] ?? idx` 作子块 blockIndex——Step 2 tool 块只需在 useMessageSearch 扫 tool_use 三子域 + ContentBlockItem tool_use 分支接块级高亮，索引链路已通
  - MarkdownRenderer 的 wrap 管道已覆盖 p/li/h1-h6/strong/em/th/td/code（hljs 拆分的块级代码顶层无 string child，命中自然降级块级 fallback）
  - 跳转三级 fallback 在 AgentChat 的 `jumpToActiveMatch`（mark → `[data-message-id] [data-block-index]` → scrollToMessage+flash）
- 下个 step 该从哪里继续：useMessageSearch 的 assistant 分支加 tool_use 扫描（toolName / JSON.stringify(toolInput) / toolOutput 文本按序拼为单域，hitIndexInBlock 连续编号，id 用原始 blockIndex）；渲染端 tool 卡按计划做块级定位（卡片高亮+展开+滚动），不做域内 mark
- 待办或已知限制：
  - query 含 markdown 语法字符 / 命中被 hljs 拆散时，渲染端域内命中数可能少于搜索端，该块内后续编号漂移 → 降级块级定位（有反馈不静默），属模型固有近似，未做特殊处理
  - CollapsibleBlock（thinking/工具组）与 InjectedMessageCard 收起时 mark 不在 DOM，靠三级 fallback 兜底；自动展开 CollapsibleBlock 需提升 open 状态，本 step 未做
  - Step 2 扫 tool 域时注意 toolOutput 可能是对象，需与数据流实际类型对齐后决定序列化方式
