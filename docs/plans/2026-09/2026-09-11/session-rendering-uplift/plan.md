# 会话渲染优化 实施计划

**目标**：落地设计文档 `../session-rendering-uplift-design.md` 的 11 项——注入消息实时渲染与独立样式、task-execution 卡片、小地图轮次修正、工具渲染三件套（ReportTaskResult / NoteCard / SendMessage 交付卡）、选中交互（引用/存笔记）、TrackUserActions 勾选卡、死代码清理。

**架构思路**：主进程给 `PiSession.sendMessage` 加注入标记，`message_end(user)` 时广播带 tag 的内容事件；前端 streamReducer 收事件 push 消息、MessageItem 按 tag 分色渲染为独立卡片（脱离用户气泡）；轮次头只认真人消息。选中交互照抄 ArticlePreview 模式；TrackUserActions 走「agent 提议 → 用户勾选 → appendStateUserEntry 写状态卡」闭环。排除的选项：不解析注入文案结构（只按 tag 分色）；不给勾选做服务端持久化（localStorage 按 toolUseId 记）。

**涉及模块**：
- 主进程：`electron/main/agents/pi-session/pi-session.ts`、`message-converter.ts`、`delegation-bridge.ts`、`delegation-resume.ts`、`delegation-terminal.ts`、`services/task-queue.ts`、`agents/model-failover.ts`、`agents/tools/group-tools.ts`
- 前端：`components/agent-chat/`（transformers / MessageItem / utils / turns / minimap-utils / MessageMinimap / ContentBlockItem / ChatInputArea / TopicQuickEntry / task-aggregator / TodoListBlock / AgentChat）、`components/ToolBlock.tsx`、`tool-renderers/`、`stores/reference-store.ts`、`hooks/useSendMessage.ts`

## 步骤索引

- [x] [Step 1: 主进程注入事件广播 + sender tag schema](./step1-mp-injection-event.md) — sendMessage 加 injectionTag，message_end(user) 广播内容事件，调用点打 tag
- [x] [Step 2: 前端注入消息渲染 + task-execution 卡片](./step2-fe-injected-message.md) — streamReducer user 分支、独立卡片样式分色、task-execution 折叠卡、failover 复用既有样式
- [ ] [Step 3: 轮次与小地图修正](./step3-turns-minimap.md) — isHeader 排除注入消息、预览剥标签、成员预览类型前缀
- [ ] [Step 4: 工具渲染三件套](./step4-tool-renderers.md) — ReportTaskResult 渲染器+跳转、NoteCard 标题+跳转、SendMessage 交付卡
- [ ] [Step 5: 选中交互（引用 + 存笔记）](./step5-selection-actions.md) — 消息流选区浮动按钮组、messageSnippets 引用链路、createNote 存笔记
- [ ] [Step 6: TrackUserActions 勾选卡 + TopicQuickEntry 退役](./step6-track-user-actions.md) — 新工具、勾选渲染器、删输入框快捷按钮
- [ ] [Step 7: 死代码清理](./step7-dead-code-cleanup.md) — 旧 SDK hook 事件分支、task-aggregator、TodoListBlock 删除

## 全局决策

- **injectionTag 枚举**：`'delivery' | 'reply' | 'terminal' | 'resume' | 'task-execution' | 'failover'`。sender 标签新增 `tag` 属性同枚举（task-execution/failover 消息不带 sender 标签，靠内容特征识别）。
- **颜色系**：delivery 绿 / reply 蓝 / terminal 红橙 / resume 蓝（与 reply 同色系但徽标不同）/ failover 沿用既有 FailoverContinueNotice 虚线条。旧历史无 tag：`delivery="true"` → 绿，其余含「终止/失败/耗尽/quota」关键词 → 红，兜底蓝。
- **注入判定口径**：前端统一帮助函数 `isInjectedUserMessage(content)`（utils.ts，识别 sender 标签 / task-execution 包裹 / failover 哨兵），turns.ts 与 MessageItem 共用，不各写一套正则。
- **消息去重**：注入内容必带标签前缀，与 UI 本地乐观 push 的用户消息不可能同文本，streamReducer 不做额外去重；未打 tag 的 user 消息（UI 发送 / skill 文档 / meta）主进程不广播内容事件，维持现状。
- **TrackUserActions**：挂 dogear-group server（group-tools.ts，groupId 闭包注入，空则不注册）；勾选态 localStorage key `user-action:{conversationId}:{toolUseId}`（值 = 已勾 index 的 JSON 数组）。
- **不写单测**，每步按 step 文档「验证」小节人工验证；主进程改动后 `bun run build:electron` 重编译。
- **CardRendererProps 统一加 `toolUseId?: string`**（Step 6 引入，ContentBlockItem 透传 block.toolUseId）。
