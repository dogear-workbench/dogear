# 会话渲染优化设计（注入消息 + 工具卡片 + 选中交互 + 用户待办勾选）

**日期**：2026-09-11
**状态**：设计定稿待评审（渲染面全量盘点见文末附录，范围可能追加）

## 背景

1. 子会话交付/回复/终态通知经 `pushToParentSession → PiSession.sendMessage` 注入父会话后，**实时流不渲染**（`message-converter.ts` 只转 assistant 侧事件，user 消息仅有落盘后的 message_id uuid 事件），重新加载历史才可见。
2. 历史渲染时注入消息套在**用户气泡**里（border-2 + sticky），仅靠「来自 xxx」小徽章区分，与真实用户消息混淆。
3. 任务执行会话首条 `<task-execution>` 提示词（task-queue.ts `buildExecutionPrompt`）以原始 XML 全文渲染，占屏且难读。
4. `dogear__ReportTaskResult` 无专属渲染器，看不出「任务进入待审核」。
5. `NoteCardRenderer` 正文显示裸 `卡片: noteId`，标题行跳转按钮不显眼；Update/Append 场景只有 ID 没有标题。
6. 会话流没有任何选中交互；文章预览区已有「选中 → 浮动按钮 → 引用到对话」完整模式（ArticlePreview.tsx:83）可复制。
7. TopicQuickEntry（输入框旁「这事做完了/记一笔」）抽象：原意是让用户把**线下完成、agent 不知道的事**回流到话题状态卡，但手动打字门槛高；agent 侧也没有提议通道。

## 目标（11 项）

| # | 事项 | 性质 |
|---|------|------|
| 1 | 注入消息实时渲染 + 独立视觉样式 | 修 bug |
| 2 | `<task-execution>` 卡片化 | 增强 |
| 3 | 终态通知 / resume 提示独立样式 | 增强 |
| 4 | 会话内选中 → 引用到对话 | 新交互 |
| 5 | 会话内选中 → 存为笔记（替代「值得记」勾选方案） | 新交互 |
| 6 | `dogear__ReportTaskResult` 专属渲染器 + 跳转 | 增强 |
| 7 | NoteCardRenderer 增强（标题 + 跳转） | 增强 |
| 8 | `dogear__TrackUserActions` 用户待办勾选卡片（替代 TopicQuickEntry） | 新机制 |
| 9 | 轮次/小地图：注入消息不作轮次头，并入当前轮成员 | 修 bug |
| 10 | `dogear__SendMessage`（delivery=true）交付动作卡片 | 增强 |
| 11 | 旧 SDK hook 事件死代码清理（见附录清单） | 清理 |

## 架构

### 1. 注入消息实时渲染（主进程 + 前端）

**主进程**（electron/main/agents/pi-session/）：
- 注入判定：`PiSession.sendMessage` 增加可选注入标记（如 `injectionTag?: string`，值 `delivery` / `reply` / `terminal` / `resume` / `task-execution`）。调用方：delegation-bridge `pushToParentSession`、`resumeChild` wakeupMessage、task-queue `buildExecutionPrompt`、model-failover 续跑提示。
- PiSession 内部维护 `pendingInjected` 队列（sendMessage 时记文本+tag），`message_end` 且 `role === 'user'` 时按内容匹配出队；命中则广播内容事件 `{ type: 'user', content, injectedTag, timestamp }`，与现有 message_id 并行发出。未标记的 user 消息（UI 正常发送、skill 文档、meta）不广播内容事件，维持现状。
- 兼容历史：sender 标签 schema 加 `tag` 属性（`<sender kind="agent" ... tag="delivery"/>`），旧历史无 tag 默认按文案特征兜底（delivery="true" → delivery，其余 reply）。

**前端**：
- `transformers.ts streamReducer`：新增 `type: 'user'`（带 injectedTag）分支 → push `createUserMessage`。去重：注入内容带 `<sender>`/`<task-execution>` 前缀，与本地乐观 push 的用户消息不可能同文本，无需额外去重。
- `MessageItem.tsx`：`parsed.senderKind === 'agent'` 或识别 `<task-execution>` 的消息**不走用户气泡**——改为左侧彩色竖线 + 浅底色圆角卡、非 sticky、无遮挡；按 injectedTag 分色：delivery 绿、reply 蓝、terminal 红橙、resume 蓝、task-execution 见 #2。

### 2. `<task-execution>` 卡片化

- `utils.ts` 解析扩展：识别 `<task-execution>...</task-execution>` 包裹，提取任务标题 / 任务 ID / 计划文档路径，剥离原文。
- MessageItem 渲染为折叠卡片（样式对齐「压缩摘要」卡）：收起态一行「任务执行会话 · 《标题》」，展开显示 plan 路径（PathChip）+ 执行约定全文。
- 该分支优先级高于 sender 独立样式分支（task-execution 消息无 sender 标签）。

### 3. 终态通知 / resume 提示

- 依托 #1 的 injectedTag 分色：`terminal`（buildTerminalNotice 产物）红橙色系卡片 + 原文；`resume`（buildResumePrompt 产物）蓝色系 + 原文。不解析文案结构，视觉区分即可。
- 历史消息（无 tag）按 sender delivery 属性 + 文案关键词兜底分色，兜底失败统一 reply 蓝。

### 9. 轮次与小地图：注入消息不作轮次头

- 现状 bug：`turns.ts isHeader` 只排除 SDK 命令格式，`<sender>` / `<task-execution>` 注入的 user 消息被当作轮次头（小地图把它显示成「你发的话」，预览还露出标签 XML 原文）。
- 修改：`isHeader` 排除注入类 user 消息（前端统一 `isInjectedUserMessage(content)` 帮助函数：sender 标签 / task-execution 包裹 / failover 哨兵；与主进程 tag schema 同口径）；命中则并入当前轮 memberIds。
- 小地图 hover 卡片：轮次头预览永远只有真人消息；注入消息进入成员预览区，带类型前缀（↩ 交付 / ↩ 回复 / ⚠ 子会话终止 / ↻ 续跑）。
- `extractMessagePreview` 补剥 `<sender .../>` 自闭合标签与 `<task-execution>...</task-execution>` 包裹。
- sticky 吸顶行为不变：吸顶的永远是最近的真人 user 消息（注入消息非 sticky 天然不参与）。

### 10. `dogear__SendMessage` 交付动作卡片

- 子会话视角：调 `dogear__SendMessage(父, summary, { delivery: true })` 时，tool_use 块渲染为「交付摘要」卡片（绿色系与 #1 交付注入消息呼应）：摘要正文 + 目标（父会话名）。
- DOGEAR_TOOL_ICONS / DOGEAR_CARD_TITLES 注册；delivery=false 的普通 SendMessage 保持通用渲染（低频追问不值得专属卡）。

### 4/5. 会话内选中 → 引用 / 存笔记

- 交互模式照抄 ArticlePreview：消息流容器 mouseup 检测选区（限定在消息内容区域内）→ 选区上方浮动按钮组「引用」「存笔记」→ mousedown 触发（防选区清除）。
- **引用**：reference-store 新增 `messageSnippets`（`{ id, text, sourceLabel, timestamp }`，anchorConversationId 锚定同现有引用）。ChatInputArea 渲染芯片（灰蓝系与文章 snippet 区分）；useSendMessage 发送时包裹 `<quoted_snippet source="会话消息">标签`（格式与文章 snippet 一致，agent 侧零改动可理解；MessageItem 解析已支持，芯片 title 显示来源）。
- **存笔记**：直接 `client.createNote`，正文 = 选中内容 + 末尾来源行「> 来自会话消息 · <会话标题> · <时间>」；toast 成功带「查看」动作（switchTab NOTES + setActiveNoteId）。

### 6. `dogear__ReportTaskResult` 渲染器

- 新 `TaskResultRenderer`（tool-renderers/）：标题「申报任务结果」，渲染 result 摘要 + 输出中解析的任务 ID/标题/状态徽章（review 待审核）；isError 走错误样式。
- `buildResultAction` 加 ReportTaskResult 分支：从输出提取任务 ID → ExternalLink「打开任务」（复用 requestTaskFocus 模式）。
- DOGEAR_TOOL_ICONS / DOGEAR_CARD_TITLES 注册。

### 7. NoteCardRenderer 增强

- Update/Append 场景：渲染时异步 `client.getNote` 拉标题（模块级 Map 缓存 noteId → title，notesChanged 广播失效），「卡片: noteId」行变为「卡片: 标题（id 短码）」，行可点 = 打开笔记面板定位。
- CreateNote 场景标题已有（正文首行），补行级跳转。
- 拉取失败（卡片已删）降级显示原 noteId + 灰字「（卡片不存在）」。

### 8. `dogear__TrackUserActions` 用户待办勾选卡片

**工具**（electron/main/agents/tools/，挂 dogear-group server 或独立文件）：
- schema：`{ actions: string[] }`（1~N 条，每条一句话描述用户要做的事）。
- description 引导：当事项必须由用户本人完成（登录/授权/线下操作/人工拍板）且需要后续跟踪时调用；用户在会话界面勾选完成后自动记入话题状态卡「已完成」区，后续会话读背景自然感知——不需要等待用户回复。
- 挂载条件：主会话 && groupId 存在（对齐 notes 工具挂载策略）。
- handler 只回执（不落库）；落库由前端勾选动作驱动。

**渲染**（tool-renderers/TrackUserActionsRenderer.tsx）：
- 每条一行：checkbox + 文本；勾选 → `client.appendStateUserEntry({ category: 'completed', text: 原文 })` + localStorage 记勾选态（key `user-action:{conversationId}:{toolUseId}` → 已勾 index 集），历史重载不丢、不重复写。
- 勾选不打断会话、不注入消息——状态卡是既有的异步同步载体。
- ToolBlock 的 CardRendererProps 需补传 `toolUseId`（ContentBlockItem 透传 block.toolUseId）。

**TopicQuickEntry 删除**：ChatInputArea 引用清理，「记一笔」场景由 #5 覆盖、「这事做完了」由 #8 覆盖。

## 模块边界

| 层 | 文件 | 改动 |
|----|------|------|
| 主进程 | pi-session/pi-session.ts、message-converter.ts | 注入标记 + user 内容事件广播 |
| 主进程 | delegation-bridge.ts、delegation-resume.ts、delegation-terminal.ts、task-queue.ts、model-failover.ts | 注入调用点打 tag；sender 标签加 tag 属性 |
| 主进程 | tools/（group-tools.ts 或新文件）、pi-session.ts 组装处 | TrackUserActions 工具 + 挂载 |
| 前端 | agent-chat/transformers.ts、MessageItem.tsx、utils.ts | streamReducer user 分支、注入消息独立样式、task-execution 解析 |
| 前端 | agent-chat/hooks/useSendMessage.ts、stores/reference-store.ts、ChatInputArea.tsx | messageSnippets 引用链路 |
| 前端 | AgentChat.tsx（或消息流容器组件） | 选中浮动按钮组 |
| 前端 | ToolBlock.tsx、tool-renderers/（TaskResult 新增、NoteCard 增强、TrackUserActions 新增） | 工具渲染 |
| 前端 | turns.ts、minimap-utils.ts、MessageMinimap.tsx | 轮次头排除注入消息、预览剥标签、成员预览类型前缀 |
| 前端 | ContentBlockItem.tsx、task-aggregator.ts、TodoListBlock.tsx | #11 死代码清理（验证后） |
| 前端 | TopicQuickEntry.tsx 删除 | — |

## 数据流（关键两条）

1. **子会话交付 → 父会话实时可见**：子会话 SendMessage(delivery) → bridge.markChildDelivered → pushToParentSession → PiSession.sendMessage(text, { injectionTag: 'delivery' }) → message_end(user) 匹配 pendingInjected → 广播 `{type:'user', content, injectedTag:'delivery'}` → 前端 streamReducer push → MessageItem 独立绿卡渲染。
2. **用户勾选待办 → 状态卡**：TrackUserActionsRenderer 勾选 → appendStateUserEntry(completed) → 状态卡落盘广播 → 后续会话 ReadGroupBackground / 开局注入读到。

## 错误处理 / 边界

- pendingInjected 匹配失败（message_end 顺序异常）：只丢实时性不丢数据，历史加载兜底可见。
- appendStateUserEntry 失败：toast 报错、checkbox 不置勾（可重试）。
- localStorage 勾选态与状态卡不一致（用户清了 localStorage）：勾选态丢失但状态卡记录仍在，重复勾选会重复写一条 completed——appendStateUserEntry 文本级去重由后端（60s 相同内容）或前端（已勾 index 判断）规避，接受残留风险。
- 旧历史消息无 tag：兜底分色逻辑覆盖。
- getNote 拉标题失败：降级裸 noteId。

## 未决问题（实施时补）

- sender 标签加 tag 属性后，transcript-adapter / 状态卡抽取侧是否需要同步识别（预计不需要，标签只是前缀行，清洗逻辑按行剥离）。
- 注入消息与 Minimap 的关系：**已决——并入当前轮作成员，不作轮次头（#9）**。
- messageSnippets 芯片在独立会话窗口（session-window）的锚定行为（对齐 quotedSnippets 的 anchor 机制即可）。
- 死代码清理前验证：旧 SDK 历史已归档不回放（`.dogear/conversations/`），清理风险低；保留分支先确认真无新事件再删。

## 附录：渲染面全量盘点（2026-09-11，供追加范围）

**消息级**：用户气泡（引用芯片/sender 徽章/命令芯片/failover 条/压缩摘要卡）、助手内容块流。缺口 = #1 #2 #3。

**内容块级（ContentBlockItem）**：text/thinking/tool_use/tool_group/permission/askUser/compact_boundary/compacting/error 有专属渲染；`session_start`、`session_end`、`stop`、`tool_failure`、`notification`、`task_notification`、`local_command_output`、`user 重放`、`TodoWrite/TaskList/TaskCreate/TaskUpdate 特判 + task-aggregator` 为旧 SDK 时代遗留，pi 会话不再产生（待验证后清理）。

**工具级（ToolBlock）**：已专属渲染 Read/Write/Edit/Glob/Grep/Skill + CreateSession(Batch)/Save(Forget)Memory/Create(Update/Append)Note/CreateTask/ExecuteTask；本计划补 ReportTaskResult + TrackUserActions + SendMessage 交付卡。仍未覆盖的候选（本轮不做）：ListTasks（任务行渲染）、GetStockQuote 等行情工具（自选股页已覆盖）、browser observe/read_state（长输出滚动已可接受）、ReadGroupBackground / ReadReferenceSession / ListTopics（调研类低频）。
