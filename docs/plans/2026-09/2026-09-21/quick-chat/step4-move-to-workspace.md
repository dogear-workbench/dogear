---
step: 4
title: 移入工作区
status: done
---

## 目标

临时会话可移入真实工作区：索引迁移 + session 文件搬运 + 组归属选择 UI；agent 可用只读话题工具辅助建议归置。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 3 临时会话完整可用；PERSONAL_WORKSPACE_ID 常量与 personal 数据形态（单会话组）已落地
- 关键现状签名：
  - 索引迁移：`conversation-service.ts` `importConversation(targetWorkspaceId, conv)`（:628，已存在，保留原 ID、目标已存在则跳过）——**只动 conversations.json，不搬 session JSONL**
  - session 文件：`pi-session-repository.ts` 按 workspaceId 缓存 JsonlSessionRepo，session 根目录 `<configDir>/workspaces/<id>/sessions/`
  - 组：`group-service.ts`；移入需选目标组或新建组
  - 只读话题工具：`tools/reference-tools.ts` ListTopics / ReadGroupBackground（组协作组，已存在）
- 关键决策回顾：移入后按工作区语义归组（现有组/新建组），隐式单会话组随之消解；agent 只建议，执行靠用户点 UI

## 计划改动

- [x] 主进程新服务函数 `moveConversationToWorkspace(personalConvId, targetWorkspaceId, targetGroupId | 'new' + title)`（独立文件 `conversation-move-service.ts`）：
  - 前置校验：session 运行中拒绝（查 pi-session-manager 存活集合）；目标组存在性校验
  - session JSONL 搬运：目标 repo 侧 create 同 id session + 源文件 header 之后行原样拼接 + header cwd/timestamp 改写，并使 pi-session-repository 两侧缓存失效（relocateSession 方法）
  - 索引：目标 conversations.json 写入（复用 importConversation 逻辑）+ groupId 更新为目标组 + personal 侧 deleteConversation + personal 隐式组删除（group-service）
  - 完成后广播两侧 conversationListChanged
- [x] tipc 路由：新 IPC（moveConversationToWorkspace），前端 confirm-store 确认后调用（涉及数据搬迁，用 showConfirm 而非静默）
- [x] UI 入口：临时会话顶部徽章旁「移入工作区」按钮 → 弹层选工作区（getAll 过滤 personal）+ 组（现有组列表/新建组输入）；执行中 loading，成功后跳转/聚焦目标会话（focusConversation 基建，注意「先切后高亮」铁律：先 await setWorkspace 再 focusConversationById）
- [x] agent 辅助：personal 会话能力包放行 ListTopics / ReadGroupBackground（只读），提示词引导「用户要移入工作区时可列近期话题给建议」；agent 不获得任何写工具
- [x] 移入后的会话不再受 7 天归档（它已是目标工作区普通会话，30 天组归档照常）——验证即可
- [x] `bun run build:electron` + 手动验收（逻辑链路已用 bun 脚本直跑验证；GUI 全流程验收待 bun run dev）

## 验收

- [x] 临时会话移入工作区后：目标工作区列表可见、历史消息完整可读、topic 归属正确（bun 脚本验证索引/文件/header；GUI 待 dev）
- [x] personal 侧会话与隐式组消失，列表刷新无残留（广播链路：deleteConversation/deleteGroup 自带广播 → 前端监听路由 loadPersonalConversations）
- [x] 移入后新消息正常（session repo 指向新路径，无「找不到会话」）：relocateSession 后 getSessionPath/open(target) 验证通过；前端 tab.workspaceId 变化驱动 useAgentSession 重 attach
- [x] 运行中的会话移入被拒绝并提示（isRunning() 检查 → tipc error → 前端 toast；GUI 交互待 dev）
- [x] agent 在临时会话可列话题给归置建议（只读），不能读工作区文件（dogear-history 放行仅 ListTopics/ReadReferenceSession/ReadTopicCard；basePaths 仅 configDir 顶层禁写不变）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **session JSONL 搬运不是纯 rename**：JSONL 首行是 session header（含 cwd/timestamp），且存储布局是 `sessions/<encodeCwd(cwd)>/<timestamp>_<id>.jsonl`。relocateSession 改为目标 repo 侧 `create({ cwd, id })`（得正确路径与 header）+ 源文件 header 后行原样拼接 + header.cwd 改写为目标 cwd、timestamp 保留源值，最后删源文件。纯 rename 会留旧 cwd 且路径布局错误。
  2. **ReadGroupBackground 未放行**（它属 dogear-group-context 组、绑定 personal 隐式组且会触发状态提炼，对归置无意义）；改为 dogear-history 组新增 `dogear__ReadTopicCard(workspaceId, groupId)`（直读任意工作区话题状态卡，纯读不触发提炼），与 ListTopics 的跨工作区参数配合覆盖归置建议需求。提示词引导合入工具 description，未新增提示词段。
  3. **运行中检查用 `session.isRunning()` 精确判断**而非全部存活集合：存活但 idle 的会话先 `closeConversation()` 释放文件句柄再搬运（用户必然开着会话点按钮，拒绝 alive-idle 会让功能不可用）；前端通过 tab.workspaceId 变化 + useAgentSession 依赖 workspaceId 重 attach。
  4. **跳转不用 closeTab/openTab**（会触发两次焦点联动、存在跨工作区 setWorkspace 竞态），改为 session-store 新增 `updateTabWorkspace` 原位改写 tab 归属 + 先 await setWorkspace 再 focusConversationById。
  5. pi-session.ts 最小补丁（单独可摘出）：`buildMainAgentToolDefs` 末尾 dogear-history 注册条件 `workspacePath` → `workspacePath || workspaceId === PERSONAL_WORKSPACE_ID`，加一行 import；仅主会话分支（personal 无子会话）。
- 改动文件清单：
  - 新增：`electron/main/services/conversation-move-service.ts`、`components/agent-chat/MoveToWorkspaceDialog.tsx`
  - 修改：`electron/main/agents/pi-session/pi-session-repository.ts`（relocateSession）、`electron/main/tipc/conversations.ts`（纯追加路由）、`electron/main/agents/tools/reference-tools.ts`（ListTopics 加 workspaceId 参数 + ReadTopicCard）、`electron/main/agents/pi-session/pi-session.ts`（最小补丁，见上）、`stores/session-store.ts`（updateTabWorkspace）、`stores/conversation-store.ts`（movePersonalConversationToWorkspace）、`components/agent-chat/AgentChat.tsx`（按钮+弹层）、`components/agent-chat/hooks/useAgentSession.ts`（attach effect 依赖加 workspaceId）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `moveConversationToWorkspace({ conversationId, targetWorkspaceId, targetGroupId?, newGroupTitle? }): Promise<{ ok: true; conversationId; groupId; workspaceId } | { ok: false; error }>`（conversation-move-service.ts）；tipc 同名路由 input 相同
  - `PiSessionRepository.relocateSession(fromWs, toWs, sessionId): Promise<string>`（目标文件绝对路径）；目标会话 id 不变，header.cwd=目标 cwd
  - `dogear__ListTopics({ workspaceId? })` / `dogear__ReadTopicCard({ workspaceId, groupId })`：personal 会话可用（dogear-history 组在 personal 主会话放行）
  - 前端：`movePersonalConversationToWorkspace(conversationId, targetWorkspaceId, targetGroupId?, newGroupTitle?): Promise<boolean>`；`updateTabWorkspace(conversationId, workspaceId, title?)`
- 下个 step 该从哪里继续：Step 5/6 分流建议卡（shunt 标签格式定稿后回填 plan.md）；本 step 的 UI 弹层与 agent 归置建议动线已就绪，建议卡可引导用户点「移入工作区」按钮
- 待办或已知限制：
  1. GUI 全流程手动验收（bun run dev）：移入按钮 → 弹层选择 → 确认 → 跳转 → 新消息；运行中会话拒绝提示
  2. fork 出的子会话（role=sub）不处理移动（personal 无子会话场景）；parentConversationId 跨工作区引用不改写（personal 会话无父引用）
  3. relocateSession 的 header.parentSession（fork 源）指向旧工作区路径，搬运后不重写（跨工作区 fork 场景本就不成立，暂无消费方）
