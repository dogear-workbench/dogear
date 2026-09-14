# 会话组上下文三项修复与文案校准 设计

**背景**：用户反馈三个问题——① 主会话调 `dogear__ReadGroupBackground` 时当前会话自己仍被列入抽取目标（应已排除）；② 「开局第一轮先调 ReadGroupBackground」的强指引体验差（等待长、多数场景不需要）；③ 工具等待期 UI 只显示「正在执行工具...」，慢工具无差异化提示。另有侧边栏/设置页文案仍描述旧的「开启会话自动提炼」机制（现为读时同步，开局零触发）。

**目标**：主会话不再抽取自己；指引改为按需触发；ReadGroupBackground 等待期有专属 UI 文案；用户可见文案与新机制一致。

## 改动清单

### 1. Bug：主会话注册漏传 selfConversationId

- `electron/main/agents/pi-session/pi-session.ts:713`（`buildMainAgentToolDefs`）：`createGroupContextToolDefs({ workspaceId, groupId })` 补传 `selfConversationId: this.config.conversationId`（对齐子会话注册点 pi-session.ts:836 的既有写法）。
- 根因链：主会话调 ReadGroupBackground → `ensureGroupFresh(wsId, gid, timeout, undefined)` → `getStaleConversations` 不排除自己 → 自己被列为未提炼会话 → STATE_EXTRACT 现场抽取自己的进行中对话。
- 附带收益：未提炼会话仅剩自己时秒回（stale 为空直接 `synced=true`），大量「等待 30s~2min」场景消失。

### 2. 指引改为按需触发

- `electron/main/agents/group-context-builder.ts:84`：
  - 旧：`【指引】${topicRef}开局第一轮先调 dogear__ReadGroupBackground 获取话题最新状态${syncNote}；深挖某会话可 dogear__ReadReferenceSession。`
  - 新：`【指引】${topicRef}若用户消息缺少上下文、所指对象不明、或需接续历史脉络/查看进行中事项时，调 dogear__ReadGroupBackground 获取最新状态${syncNote}；深挖某会话可 dogear__ReadReferenceSession。`
  - syncNote（「存在未提炼会话时会自动同步，可能需等待；未提炼会话中可能有更晚的事实」）保留不变。
- `electron/main/agents/session-append-templates.ts:83`：模板文本同步改写（同一句指引的用户可见描述）。

### 3. 慢工具等待期专属文案

- `components/agent-chat/LiveTail.tsx:39-41`：不只取 `lastBlock.type`，改为把 lastBlock（含 toolName）传给 StreamingIndicator。
- `components/agent-chat/StreamingIndicator.tsx`：`tool_use` 分支下若 `toolName === 'dogear__ReadGroupBackground'` 显示「正在获取话题背景（可能需同步未提炼会话，最长约 2 分钟）…」，其余维持「正在执行工具...」。
- 单工具特判即可，出现第二个慢工具再抽映射表（YAGNI）。

### 4. 用户可见文案校准（提炼时机已改为读时同步）

- `components/TopicStateCardSection.tsx:131`：「话题状态尚未生成，开启会话后自动提炼」→「话题状态尚未生成，会话中 agent 获取话题背景时提炼」
- `components/TopicStateCardSection.tsx:137`：「暂无状态记录，开启会话后自动提炼」→「暂无状态记录，会话中 agent 获取话题背景时提炼」
- `app/settings/page.tsx:365`：「开启话题组会话时增量提炼话题状态卡的后台任务使用此模型」→「会话中同步提炼话题状态卡的后台任务使用此模型」（后半句「运行频繁，适合配置便宜档」保留）

## 模块边界

涉及 7 个文件，均为小改：1 处传参修复（pi-session.ts）、3 处提示词/模板文案（group-context-builder.ts、session-append-templates.ts）、2 个前端组件（LiveTail.tsx、StreamingIndicator.tsx）、2 处用户可见文案（TopicStateCardSection.tsx、settings/page.tsx）。不改存储 schema、不改抽取执行器、不改 IPC 路由。

## 错误处理 / 边界情况

- `this.config.conversationId` 在主会话工具注册时已有值（同文件 browser/extension 注册点均在用），无空值风险。
- LiveTail 的 `fallbackLastBlockType` 场景（liveTail 为空）维持现状，仅 type 级区分。
- 侧边栏 `readTopicStateCard`（tipc/group.ts:197）纯读不触发同步，文案语义与该行为一致。

## 未决问题

无。
