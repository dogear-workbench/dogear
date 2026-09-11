---
step: 5
title: 选中交互（引用 + 存笔记）
status: pending
---

## 目标

会话消息流内选中文字 → 浮动按钮组「引用」「存笔记」：引用进输入区芯片随消息发送；存笔记直接建卡可跳转。

## 依赖上下文（接力棒输入）

- 设计文档 #4/#5 节
- 参照实现：`components/ArticlePreview.tsx:83-210`（SelectionTooltip + mouseup 选区检测 + requireReferenceAnchorId 锚定 + mousedown 防选区清除），本步整体复制该模式到会话流容器
- 当前关键文件状态：
  - 消息流滚动容器在 `AgentChat.tsx`（scrollAreaRef 同 useChatScroll 使用处）；MessageItem 渲染层无选区概念
  - `stores/reference-store.ts`：quotedSnippets（文章片段）`{ id, articleId, articleTitle, text, anchorConversationId }` 模式
  - `hooks/useSendMessage.ts`：quotedSnippets 序列化为 `<quoted_snippet source="标题">文本</quoted_snippet>` 追加进发送文本
- 关键决策回顾：新独立列表 `messageSnippets`（不混进 quotedSnippets，来源类型不同）；发送标签沿用 `<quoted_snippet source="会话消息">`（MessageItem 解析零改动，agent 侧格式一致）

## 计划改动

- [ ] `stores/reference-store.ts`：`messageSnippets: MessageSnippetRef[]`（`{ id, text, timestamp }`）+ add/remove/clear，锚定机制与 quotedSnippets 一致（anchorConversationId）
- [ ] 新组件 `components/agent-chat/SelectionActionTooltip.tsx`：受控浮钮组（引用 / 存笔记），props 给位置与回调；逻辑容器 hook `useMessageSelection(containerRef)`（mouseup 检测选区在容器内 + 计算浮钮位置 + mousedown 外部关闭——照抄 ArticlePreview，去掉文章特有逻辑）
- [ ] 挂载点：消息流容器（AgentChat.tsx 滚动内容区或 StableHistory/LiveTail 共同父层——选一个 DOM 上真实包裹所有消息的层，实施时确认结构），tooltip 绝对定位挂该容器
- [ ] 「引用」回调：`requireReferenceAnchorId()` 锚定（会话 tab 自身即锚定本会话）→ addMessageSnippet → 清选区；多窗口（session-window）行为对齐 quotedSnippets
- [ ] 「存笔记」回调：`client.createNote({ workspacePath, content: 选中内容 + '\n\n> 来自会话消息 · <会话标题> · <时间>' })` → toast 成功带「查看」action（switchTab NOTES + setActiveNoteId）；会话标题从 conversation-store 取
- [ ] `ChatInputArea.tsx`：messageSnippets 芯片渲染（灰蓝系，样式对齐 quotedSnippets 芯片、图标 MessageSquareQuote 或 Quote），可移除；空态不渲染区块
- [ ] `useSendMessage.ts`：发送序列化——messageSnippets 追加为 `<quoted_snippet source="会话消息">...</quoted_snippet>` 块（与 quotedSnippets 同函数追加顺序），发送后 clear

## 验证

- 选中 AI 回复一段话 → 浮钮出现 → 「引用」→ 输入区出现芯片；发送后历史消息里芯片只读渲染、agent 收到带标签文本
- 选中 → 「存笔记」→ toast「查看」跳笔记面板新卡，正文含来源行
- 选区在输入框/侧栏时不出现浮钮（容器限定生效）
- 独立会话窗口同样可用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
