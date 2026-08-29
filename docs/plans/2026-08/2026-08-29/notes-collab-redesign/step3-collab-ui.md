---
step: 3
title: 协作闭环 UI
status: done
---

## 目标
打通人机协作闭环的 UI 两端：笔记卡一键引用进会话（锚定最近活跃会话+跳转确认）；Agent 存卡带来源身份证 + 详情来源行跳回讨论。

## 依赖上下文（接力棒输入）
- 设计依据：`../note-agent-collaboration-design.md` 架构第 3、4 节
- 前置 step 产出：[step1] `NoteReference` 类型与 store API 已就绪（签名见回填）；[step2] meta 行与卡片 hover 区已预留引用按钮位
- 现状事实：`useSendMessage.ts:216-314` XML 拼接模式；`utils.ts:22-139` `parseUserMessageReferences`；`lib/reference-guard.ts` 守卫模式；`notes-tools.ts:61` CreateNote、`:103` GetNote；`types/note.ts:21-36` NoteMeta

## 计划改动
- [ ] 「最近活跃会话」判定：查 tab/会话 store 是否已有「上一个活跃会话 tab」概念，没有则补（记录最近激活的会话 tab id，笔记 Tab 激活不清除它）
- [ ] 引用按钮实装：`NoteCardItem` hover 区 + `NoteEditor` meta 行；onClick 流程——工作区守卫（笔记 workspacePath ≠ 焦点会话工作区 → toast 拒绝，照抄 `guardReferenceIntoFocus` 模式）→ `addReferencedNote`（锚定最近活跃会话）→ 激活该会话 tab + 聚焦输入框
- [ ] 无最近活跃会话时：toast 提示先打开会话（按钮不禁用，点击给指引）
- [ ] `ChatInputArea.tsx`：笔记芯片（新配色，现有 5 色已占：淡蓝/灰紫/青绿/淡紫/青柠），X 可删，无标题卡显示截断正文
- [ ] `useSendMessage.ts`：拼 `<referenced_notes><note noteId title workspacePath /></referenced_notes>`；按 noteId 去重已由 store 保证
- [ ] `utils.ts`：`parseUserMessageReferences` 加笔记正则，剥离后气泡不显示原文 XML
- [ ] `electron/main/agents/tools/notes-tools.ts`：`dogear__CreateNote` 加可选 `sourceSessionId`（+ 会话标题）参数写入 frontmatter `source`；工具描述尾部加「存卡后在回复中告知用户存了什么」（规范落点：工具描述，非系统提示词）
- [ ] `types/note.ts`：`NoteMeta` 加 `source?: { sessionId, title, date }`
- [ ] `NoteEditor.tsx` meta 行：有 source 时渲染 `🔗` 图标（tooltip 会话标题+日期），点击跳回该会话 tab

## 验收
- 从笔记 Tab 点引用 → 自动落到最近活跃会话、输入框聚焦、芯片可见、消息发出后我方 `GetNote` 能读全文
- 冷启动无会话时点引用得到 toast 指引
- 我 CreateNote 带 source 后，卡片 meta 行出现 🔗，点击跳回本会话
- 跨工作区引用被 toast 拦截
- 存量无 source 卡片 meta 行不渲染 🔗

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - **source 存 `conversationId` 而非计划字面的 `sessionId`**：tab 以 conversationId 为主键且 failover/重启后 agent sessionId 会漂移（updateSessionId 会换），用 conversationId 跳回永不失效；类型为 `NoteSource { conversationId, title, date }`，agent 无感知（工具挂载点闭包传入上下文，执行时实时查会话标题，不让 LLM 抄 ID）
  - 笔记芯片配色用玫粉 rose（计划只说新配色）：盘点发现气泡端共享文件芯片已占 amber（与输入框端的 lime 还不一致，存量问题未动），避开全部 6 色后选 rose + StickyNote 图标，气泡端同色
  - 气泡端（MessageItem）同步渲染 noteRefs 芯片：计划只要求 utils.ts 剥离 XML，但既有引用都有只读芯片，不渲染会突兀，属既有机制的自然延伸
  - 「无标题卡显示截断正文」在 referenceNoteIntoFocus 内实现：title 为空时 client.getNote 取正文首个非空行去 markdown 前缀截 40 字（NoteMeta 无正文，只能异步取一次），失败兜底「（无标题）」
  - 锚定目标在独立窗口时 toast 拒绝（主窗口 switchTab 后 display:none，芯片不可见，体验断裂）
  - GetNote 的 metaHeader 输出加来源行（agent 读卡时能感知来源会话）
- 改动文件清单：
  - 主进程：`note-types.ts`（NoteSource + NoteMeta.source）、`notes-store.ts`（frontmatter source_conversation/source_title/source_date 三标量 parse/serialize + 索引透传）、`notes-service.ts`（CreateNoteInput.source）、`notes-tools.ts`（NotesToolSourceContext + resolveSource + 描述加「存卡后告知用户」）、`pi-session.ts`（挂载点传 conversationId/workspaceId）
  - 前端 store：`session-store.ts`（lastActiveConversationTabId：openTab/switchTab 更新、哨兵不清膛、closeTab 回退尾部、reset）、`input-focus-store.ts`（新，按 conversationId 寻址的聚焦请求 seq）
  - 守卫：`reference-guard.ts`（referenceNoteIntoFocus 守卫→锚定→切 tab→聚焦；jumpToSourceConversation）
  - 会话端：`ChatInputArea.tsx`（玫粉笔记芯片 + textarea ref 响应聚焦请求）、`useSendMessage.ts`（`<referenced_notes>` 块 + clearFor）、`utils.ts`（笔记正则 + 严格校验不剥半块）、`types.ts`（ParsedNoteRef）、`MessageItem.tsx`（气泡芯片）
  - 笔记端：`NoteCardItem.tsx`（hover 引用按钮，onReference 可选，回收站不传）、`NotesPanel.tsx`（接入 handleReference）、`NoteEditor.tsx`（meta 行日期与 #N 之间：source 🔗 + 引用按钮）、`types/note.ts`（镜像 NoteSource）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `referenceNoteIntoFocus({ noteId, title, workspacePath })`：Promise<void>，守卫失败静默（已 toast）；锚定目标 = session-store.lastActiveConversationTabId
  - `jumpToSourceConversation({ conversationId, title })`：tab 未开 toast.info，在独立窗口 toast.info，否则 switchTab + requestFocus
  - `NoteSource { conversationId, title, date }`；frontmatter 三标量 `source_conversation/source_title/source_date`；source 只在 CreateNote 写入，UpdateNote 不可改（patch 无此字段，展开保留）
  - `useInputFocusStore.requestFocus(conversationId)`：任意处调用，对应 ChatInputArea 实例 useEffect 聚焦 textarea（React 19 ref 直接透传 InputGroupTextarea）
  - `createNotesToolDefs(workspacePath, sourceContext?)`：sourceContext `{ workspaceId, conversationId }`，仅主会话挂载点传
- 下个 step 该从哪里继续：Step 4 任务引擎（Task 模型 + dogear-tasks 工具组 + 队列串行），笔记页顶栏的「任务」tab 占位已在 NotesPanel 留好（mode === 'tasks' 分支）
- 待办或已知限制：
  - 来源会话删除后（非仅关 tab），🔗 点击 toast「未打开」；无「从 conversation 列表重新 openTab」的恢复路径
  - step1 已知限制延续：卡片被 A 引用后在 B 重复引用被 noteId 去重挡住；tab 弹独立窗口即清其锚定引用
  - 共享文件芯片两端口色不一致（输入框 lime vs 气泡 amber）为存量问题，本步未动，后续统一时注意气泡端也要改
  - lastActiveConversationTabId 的 closeTab 回退取剩余 tabs 尾部（最近打开）而非严格「最近激活」序，多 tab 快速关 alternately 时语义近似
