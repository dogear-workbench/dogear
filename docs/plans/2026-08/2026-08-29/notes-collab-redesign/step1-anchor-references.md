---
step: 1
title: 引用队列锚定化
status: done
---

## 目标
引用队列从「全局无主」改为「归属会话」：切 tab 芯片不漂移，发送只取只清本会话的引用；同时为笔记引用预置 NoteReference 类型与 API。

## 依赖上下文（接力棒输入）
- 设计依据：`../note-agent-collaboration-design.md` 架构第 2 节
- 现状事实（2026-08-29 调研）：`stores/reference-store.ts` 全局单例，5 数组无归属；`ChatInputArea.tsx:120-243` 直接订阅无过滤；`useSendMessage.ts:262-314` 发送后全量 clear；文字草稿本来就 per-session（`useSendMessage.ts:67` 每实例 useState）

## 计划改动
- [ ] `stores/reference-store.ts`：每类引用项加 `anchorConversationId: string` 字段；`addXxx` 签名加 anchor 参数；`clearXxx` 系列改为 `clearXxxFor(conversationId)`（或加过滤参数，取实现最顺的）
- [ ] 新增 `NoteReference { noteId, title, workspacePath, anchorConversationId }` + `addReferencedNote` / `removeReferencedNote` / `clearReferencedNotesFor`（本步只做 store 层，UI 入口在 Step 3）
- [ ] 所有 `addXxx` 调用点传入当前会话的 conversationId：`ConversationRow.tsx:213-221`、`WorkspaceExplorer.tsx:404-421`、`AdditionalFilesPanel.tsx:245-252`、`TopicPanel.tsx:246-253`、文章/片段引用调用点（Grep `addQuotedSnippet|toggleReferenceArticle` 找全）
- [ ] `ChatInputArea.tsx`：订阅处按 `anchorConversationId === 本会话id` 过滤（本会话 id 从 props/store 取，查 AgentChat 传参链）
- [ ] `useSendMessage.ts`：拼 XML 块与 clear 只处理本会话锚定项
- [ ] 会话 tab 关闭钩子：清掉锚定该会话的引用项（查 tab 关闭处理的调用点）

## 验收
- 会话 A 引用文件 → 切会话 B 输入框无芯片 → 切回 A 芯片还在
- 在 B 发消息不携带 A 的引用、A 的引用不被清空
- 发送后本会话引用清空，消息气泡内 XML 正常剥离（`utils.ts` 解析不受影响，格式未变）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 无焦点会话（首页/笔记/数据中心哨兵 tab）下所有引用入口统一 toast「请先打开会话再引用」拒绝（原全局模式可“盲引”等以后切会话漂移冒出，正是要根治的行为）；设计文档「无最近活跃会话 → toast 提示先打开会话」同向
  - 独立窗口（#/session-window/）fallback：getFocusConversationId 在 activeTab 无真实会话时回退 conversation-store.selectedConversation（ArticlePreview 选词引用只在独立窗口挂载，必须此 fallback 才不坏）
  - anchor 参数独立于业务对象传入（addXxx(file, anchorId)），引用项类型加必填 anchorConversationId；ArticleMeta 是主进程存储格式不能动，用交叉类型 AnchoredArticle = ArticleMeta & { anchorConversationId }
  - tab 关闭清理收敛在 session-store.closeTab 单点（WorkspaceTabBar 三处 + conversation-store 两处全部走它），新增聚合 clearAllFor(conversationId)
- 改动文件清单：
  - `stores/reference-store.ts`：6 类引用全部带 anchorConversationId；addXxx 加 anchor 参数；clearXxx → clearXxxFor(conversationId)；新增 NoteReference + referencedNotes + add/remove/clearReferencedNotesFor；新增 clearAllFor；reset 加 referencedNotes
  - `types/article.ts`：QuoteSnippet 加 anchorConversationId（仅渲染层消费）
  - `lib/reference-guard.ts`：新增 getFocusConversationId / requireAnchorConversationId
  - 调用点传 anchor：`ConversationRow.tsx`（会话引用）、`WorkspaceExplorer.tsx`（文章 toggle + 文件/文件夹 2 处）、`AdditionalFilesPanel.tsx`、`TopicPanel.tsx`、`ArticlePreview.tsx`（选词片段，独立窗口）
  - `ChatInputArea.tsx`：订阅原始数组 + useMemo 按 anchor === props.conversationId 过滤（主窗口/独立窗口 AgentChat 均传 conversationIdOverride，props 即本会话 id）
  - `useSendMessage.ts`：同过滤；clear 改 For(conversationId)（进入 clear 分支前提是过滤后非空，conversationId 必非 null）
  - `stores/session-store.ts`：closeTab 里 clearAllFor(conversationId)

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `NoteReference { noteId, title, workspacePath, anchorConversationId }`；store actions `addReferencedNote(note: Omit<NoteReference,'anchorConversationId'>, anchorId)` / `removeReferencedNote(noteId)` / `clearReferencedNotesFor(conversationId)`；去重按 noteId
  - `getFocusConversationId(): string | null`（lib/reference-guard.ts）：activeTabId 非哨兵 → 返回；独立窗口 hash 回退 selectedConversation
  - `requireAnchorConversationId(): string | null`：无焦点会话时 toast「请先打开会话再引用」并返回 null，Step 3 笔记引用按钮直接复用
  - `clearAllFor(conversationId)`：tab 关闭聚合清理，已接 session-store.closeTab
- 下个 step 该从哪里继续：Step 3 笔记引用按钮（NoteCardItem/NoteEditor）→ 工作区守卫 → requireAnchorConversationId（设计说「锚定最近活跃会话」，getFocusConversationId 即「当前焦点会话」；独立窗口内引用会锚定窗口自己会话，与设计「跳转即归属」无冲突）→ addReferencedNote → ChatInputArea 加笔记芯片（referencedNotes 已在 store，ChatInputArea 尚未订阅）+ useSendMessage 拼 <referenced_notes> + utils.ts 加正则
- 待办或已知限制：
  - 同一业务项被会话 A 引用后，在会话 B 再引用会被按业务 id 去重挡住（芯片仍在 A），不随“最近引用”迁移；如需迁移语义待拍板
  - 会话 tab 弹出独立窗口时主窗口 closeTab 会清该会话锚定引用（弹窗即丢引用）；设计未覆盖此场景，按“tab 关闭即清”字面语义实现
  - 主窗口哨兵 tab 下 selectedConversation 可能残留旧值（focusConversationById 对哨兵保持原选中），故锚定判定必须以 session-store.activeTabId 为权威，不能直接用 selectedConversation
  - ChatInputArea 芯片渲染结构与 useSendMessage XML 格式未动，utils.ts 解析不受影响
