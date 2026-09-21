---
step: 6
title: 操作气泡与 ForkSession
status: done
---

## 目标

打通分流执行链：建议卡按钮 → 输入框操作气泡（可编辑/可删/可忽略）→ 发送注入 `<shunt>` 标签 → agent 调 ForkSession / CreateNote 执行 → 回执可点击跳转。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 5 建议卡渲染就绪（协议格式已定稿，卡片组件暴露按钮点击回调）；协议格式见 plan.md 全局决策 6 回填
- 关键现状签名：
  - 引用芯片：`components/agent-chat/ChatInputArea.tsx` 引用芯片渲染；`hooks/useSendMessage.ts:330-362` 发送时把引用转为 `<conversation>`/`<note>` 标签注入消息文本
  - delegation 工具：`tools/delegation-tools.ts` CreateSession 建子会话+父子契约（**ForkSession 不走这条**）；delegation-bridge.ts:441 startChild 是子会话编排入口
  - 会话创建：`conversation-service.ts` create(workspaceId, groupId, title, modelSel)；组创建 group-service
  - 工具注册：文件末尾 registerTools()，命名 `dogear__` 前缀，zod 校验，错误 isError 不抛
  - 跳转：focusConversation 基建 + 「先切后高亮」铁律（跨工作区先 await setWorkspace）
- 关键决策回顾：ForkSession 创建独立平级会话——无父子契约、父会话不等交付、首条输入=分流摘要+用户当前消息；agent 只在收到 `<shunt>` 标签后执行

## 计划改动

- [x] 输入框操作气泡：ChatInputArea 新增气泡类型（action + summary 展示，可删除）；同会话同时最多一个分流气泡（新点击覆盖旧的并确认）
- [x] useSendMessage：气泡存在时发送文本前置注入 `<shunt action="new-session|new-topic|note" summary="...">用户补充文字</shunt>` 标签；无气泡则不注入（agent 不感知）
- [x] 建议卡按钮接线 Step 5 的回调：点击 → 插入气泡（携带 action + 卡上 summary）
- [x] 新工具 `electron/main/agents/tools/fork-session-tool.ts` `dogear__ForkSession`：
  - 参数：action（new-session/new-topic）、summary、userMessage、可选 title
  - 行为：new-session → 当前组内建会话；new-topic → 新建组+主会话；均为当前工作区；创建后**以摘要+用户消息作为首条输入自动发送**（复用 conversationRuntimeService attach + 发送链路，参考 delegation-bridge 创建后会话启动方式但不建契约不等交付）；返回新会话 id/标题/组信息
  - 仅主会话可用（子会话不注册）；`registerTools()` 注册元数据
- [x] `dogear__CreateNote` 接线：action=note 时 agent 调现有工具，note 内容=summary+用户补充，tags 加 `分流暂存` 之类固定标记（回填定稿）
- [x] 提示词补充：收到 `<shunt>` 标签时的行为约定（执行对应工具→简短回执→继续当前话题）；ForkSession 成功后回执中给出会话跳转（路径胶囊/focusConversation 链接）
- [x] `bun run build:electron` + 手动验收（构建/类型/lint/test 已过；GUI 全链路手动验收待 `bun run dev`，见实施回填）

## 验收

- [ ] 完整链路：岔题 → 建议卡 → 点「另起话题」→ 气泡出现 → 补充一句 → 发出 → agent 调 ForkSession → 新组新会话出现且首条消息为摘要+补充 → 当前会话收到带跳转链接的简短回执，原话题上下文未被污染
- [ ] 「另起会话」落在当前组内（组树正确）
- [ ] 「记为笔记」笔记落盘且可在笔记面板看到
- [ ] 删除气泡后发送 = 普通消息，agent 无分流动作
- [ ] 会话正在运行时发出气泡走插话排队不丢（回归）

## 实施回填（做完后填）

### 定稿协议（已回填 plan.md 全局决策 6 ②）

**气泡注入标签**：`<shunt action="new-session|new-topic|note" summary="<岔题摘要，XML 属性转义>">用户补充文字</shunt>`

- 作为独立 text block 前置于用户消息（引用块之后）；有气泡时用户输入框文本进标签正文、不再重复入块，正文可空（不加补充直接发）
- summary 属性发送端转义 `& " < >`，前端 parseUserMessageReferences 解析时反转义；action 白名单外不解析、标签原样保留（不静默丢信息）
- 前端用户消息回显：`ParsedUserMessage.shuntRef { action, summary }` 渲染为紫色胶囊，标签正文留在 userMessage 正常展示/参与搜索

### 实际改动

- 与计划差异：
  1. **气泡状态放 reference-store**（未新建 store）：气泡与引用芯片同属「输入框临时附件」，复用按 anchorConversationId 锚定 + closeTab 时 clearAllFor 自动清理的既有机制，语义内聚
  2. **建议卡按钮不经 AgentChat 回调**：ShuntSuggestionCard 位于 ConversationIdProvider 内，直接 useConversationId() + reference-store action，零 props 改动
  3. **回执跳转用 `dogear://conversation/<id>?ws=<workspaceId>` Markdown 链接**：MarkdownRenderer 的 `a` onClick 劫持该协议 → conversation-store 新 action `focusConversationFromLink`（先切后高亮，复用 movePersonalConversationToWorkspace 同款链路）；需给 ReactMarkdown 传自定义 urlTransform 放行 dogear 协议（defaultUrlTransform 会清空非安全协议 href）
  4. **note 动作的 tags 约定写进提示词段**（SHUNT_GUIDANCE_APPEND 执行约定）：「tags 必须包含『分流暂存』」，CreateNote 工具本身零改动
  5. **ForkSession 首条发送后立即 detachAttachment**：sendMessage 同步段已置 running（pi-session.ts :1212），release 归零走 orphan 保活，跑完 settled 自动回收；用户点开则 re-attach retain。无契约、无 timeout/idleWatch、无 childStates（与 delegation 的关键区别）
  6. **personal 决策（Step 5 遗留）：无需任何新禁用逻辑**。personal 的 notes 能力默认关（workspace-config-service PERSONAL_DEFAULT_CONFIG `'notes':false`，Step 3 交付确认，Step 5 交付中「notes 默认开」为误述）→ shunt-guidance 段不注入、CreateNote/ForkSession 均不注册（ ForkSession 注册条件与 notes 包 + 有组同款）。「另起会话/另起话题」在 personal 语义不成立的问题因此不存在；note 动作在 personal 也不可用（无 CreateNote），若未来要支持可单独开 notes 包
  7. **MarkdownRendererProps 导出修复**：step5 的 shunt-suggestions.tsx import 了未导出的 `MarkdownRendererProps`（HEAD 即如此，tsc --noEmit 此前未暴露），本 step 加 export 修复
- 改动文件清单：
  | 文件 | 改动 |
  |---|---|
  | `stores/reference-store.ts` | `ShuntBubble { action, summary }` + `shuntBubbles: Record<convId, bubble>` + set/remove action；clearAllFor/reset 覆盖 |
  | `components/agent-chat/shunt-suggestions.tsx` | `SHUNT_ACTION_META` 改 export；卡片按钮 onClick → `insertShuntBubble`（已有不同气泡时 showConfirm 覆盖确认） |
  | `components/agent-chat/ChatInputArea.tsx` | 顶部独立行渲染气泡（icon + 「分流 · label」+ summary + X 删除）；发送按钮启用条件加气泡 |
  | `components/agent-chat/hooks/useSendMessage.ts` | 构建独立 `<shunt>` text block（正文=输入框文本、发送即清气泡）；发送守卫/依赖数组同步 |
  | `components/agent-chat/types.ts` + `utils.ts` | `ParsedShuntRef` + parseUserMessageReferences 解析 `<shunt>`（属性反转义、正文留 userMessage） |
  | `components/agent-chat/MessageItem.tsx` | 用户消息 shunt 胶囊渲染 |
  | `components/MarkdownRenderer.tsx` | `a` onClick 劫持 `dogear://` → focusConversationFromLink；自定义 urlTransform 放行；导出 MarkdownRendererProps |
  | `stores/conversation-store.ts` | 新 action `focusConversationFromLink(href)`（URL 解析 + 先切后高亮 + 错误 toast） |
  | `electron/main/agents/tools/fork-session-tool.ts`（新） | `dogear__ForkSession`：createGroup（new-topic）/requireActiveGroup（new-session）→ create（继承父会话 modelSelection）→ attach → sendMessage（首条=分流说明+摘要+补充）→ 立即 detach（orphan 保活）；attach 失败回滚删除索引；返回文本含跳转链接与回执格式要求；registerToolGroup server `dogear-shunt` |
  | `electron/main/agents/pi-session/pi-session.ts` | ⚠️ 最小补丁（与他人未提交改动 updateModelSelection :364 区域不相邻）：import 一行 + buildMainAgentToolDefs 注册块（:762-770，条件 workspacePath && groupId && notes 包 && 非 executor） |
  | `electron/main/agents/session-append-templates.ts` | SHUNT_GUIDANCE_APPEND 追加 `<shunt>` 执行约定（ForkSession/CreateNote+「分流暂存」tag、简短回执、跳转链接原样输出、继续当前话题）；shunt-guidance 段 triggerDescription 更新 |
  | `docs/plans/.../plan.md` | 全局决策 6 ② 定稿回填 |

### 给下一步的接力棒

- 关键签名：
  ```ts
  // reference-store
  shuntBubbles: Record<conversationId, { action: 'new-session'|'new-topic'|'note'; summary: string }>
  setShuntBubble(conversationId, bubble) / removeShuntBubble(conversationId)
  // conversation-store
  focusConversationFromLink(href: string): Promise<void>  // dogear://conversation/<id>?ws=<wsId>
  // 主进程
  createForkSessionToolDefs({ workspaceId, groupId, conversationId }): ToolDef[]  // dogear__ForkSession，server 'dogear-shunt'
  ```
- 下个 step：本计划已全部完成（Step 1-6），无下个 step；后续迭代入口：GUI 全链路手动验收（见下）
- 待办或已知限制：
  1. **GUI 全链路手动验收待 `bun run dev`**（上方验收 5 项）：无 GUI 环境未真机走查；已验证的是编译/类型/lint/test、标签转义↔解析往返、URL 解析、工具 schema（zod 拒绝非法 action/空 summary）
  2. **既有 bug（非本 step 引入，未修）**：useSendMessage 笔记引用注入用 `workspaceId=` 属性，parseUserMessageReferences 的 note 正则匹配 `workspacePath=`，两者不匹配 → 带笔记引用的消息回显时笔记芯片不显示（agent 侧读标签原文无碍）；修复需同步两端正则与字段语义，超出本 step 范围
  3. 气泡存在时输入 `/斜杠命令` 会被命令拦截且气泡不消费（残留），需手动删；罕见路径，未特判
  4. personal 会话历史若残留建议卡（理论不会出现，因引导段不注入），点击仍可插气泡、发送的 shunt 标签会被 personal agent 当普通文本忽略（无执行工具）
  5. ForkSession 首条 sendMessage 若失败（rejection 已 catch）：会话索引在、session 会被回收，回执仍报成功——窗口极窄（attach 刚完成即失败），暂不加重试
