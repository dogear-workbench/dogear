---
step: 5
title: 选中交互（引用 + 存笔记）
status: done
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
  - hook useMessageSelection 与 SelectionActionTooltip 同文件（内聚 data-selection-actions 属性名）
  - 浮钮位置加 clamp 防出界（ArticlePreview 无，会话流选区可贴边）
  - 存笔记走 useNotesStore.createNote（非裸 client，本地列表即插保证「查看」时列表已含新卡）
  - 独立会话窗口 toast 不带「查看」（无笔记面板，对齐 ArticlePreview 先例）
  - 芯片色系落地 indigo（slate 被文章芯片占用）
- 改动文件清单：`stores/reference-store.ts`（MessageSnippetRef + add/remove/clearMessageSnippetsFor + clearAllFor/reset 纳入）、新 `components/agent-chat/SelectionActionTooltip.tsx`（受控浮钮组 + useMessageSelection hook）、`AgentChat.tsx:171-214`（回调 + 挂载 div.px-6 + tooltip 渲染）、`ChatInputArea.tsx`（indigo 芯片）、`hooks/useSendMessage.ts:307-316`（序列化 + clear）
- 挂载点确认：AgentChat 滚动视口内 div.px-6 是 StableHistory+LiveTail 真实共同父层，tooltip 随内容滚动，坐标 = rangeRect − containerRect

### 给下一步的接力棒
- 关键签名 / 数据结构：`MessageSnippetRef { id, text, timestamp, anchorConversationId }`；`useMessageSelection(containerRef) → { position, selectedText, clear, handleMouseUp }`；发送格式 `<quoted_snippet source="会话消息">\n文本\n</quoted_snippet>`（utils 正则天然兼容，MessageItem/minimap 剥离零改动）
- 下个 step 该从哪里继续：Step 6 TrackUserActions 勾选卡 + TopicQuickEntry 退役（CardRendererProps 加 toolUseId 透传）
- 待办或已知限制：
  - 挂载层内横幅文字被选中也会出浮钮（同属消息流区域，可接受）
  - 人工验证 4 项（引用链路/存笔记跳转/容器限定/独立窗口）待用户回归
