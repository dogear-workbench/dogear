# 工作区切换与会话解耦 设计

**日期**：2026-08-21
**状态**：设计已与用户对齐，待写实施计划

## 背景

里程碑 1.5 让 tab 栏跨工作区保留会话（session-store 的 `SessionTab.workspaceId`），但 AgentChat 的 hooks 生态仍假设「全局只有一个当前工作区」——`useAgentSession` / `useTopicArchiveState` / `useMessageHistory` 都从全局 `useWorkspaceStore` 读 workspaceId。切走后回来全是坏的：

1. 切换工作区 → 全局 workspaceId 变化 → `useTopicArchiveState` effect 重跑 → `getById({ 会话X, 新工作区 })` 查不到 → `topicState='missing'` → 误报「此话题已删除」
2. 误判 `missing` → `isReadOnly=true` → `useAgentSession` effect 因 `archived` 变化重跑 → cleanup `detachConversationRuntime` → 后端 refCount 归零销毁 session → **运行中 agent 被杀**
3. 点跨工作区 tab 的交互是「先切整个工作区再聚焦」，左右面板全量闪换；工作区真被删时每次点击都弹「目标工作区不存在」

## 目标

1. 切换工作区对已挂载会话是**零事件**：不重跑任何 effect、不 detach、运行中 agent / 流式输出 / 权限等待卡片原样
2. tab 栏跨工作区会话并存，点 tab = 纯粹切换焦点，不触发工作区切换提示
3. **会话为主体**：焦点会话决定左侧列表 + 右侧文件树/附加/话题面板显示其所属工作区
4. 顶部切换器降级为「临时浏览」：只换左侧列表，不动焦点会话
5. 支持跨工作区会话引用：临时态下从浏览列表引用会话进焦点会话

## 架构

### 交互模型（用户拍板的四规则）

1. **常态**：焦点 tab 是谁，左侧列表、右侧文件树/话题/附加面板就显示谁的工作区
2. **顶部切换器**：只切「浏览的工作区」——左侧列表临时换成目标工作区，右侧焦点会话纹丝不动
3. **点任意 tab / 点列表会话**：焦点变化 → 左右自动同步到新焦点的工作区
4. **临时态引用**：左侧浏览 B 列表、焦点是 A 的会话 → 右键引用 B 的会话 → 芯片进 A 会话输入区 → 发送即跨工作区引用

### workspaceId 数据流（核心解耦）

- AgentChat 三个 hooks 的 workspaceId 唯一来源 = **tab 自带的 workspaceId**（props 显式传入；不传回落全局 store，兼容 debug 页等旧调用点）
- 全局 `useWorkspaceStore.workspace` 语义 = 「浏览的工作区」（左侧列表、新建会话归属、右栏文件面板）
- 焦点联动（放 `conversation-store.ts` 底部现有 activeTabId 订阅内，async 化）：`activeTabId` 变化 → 查 `tab.workspaceId`，若 ≠ 浏览工作区 → `getAll()` 取目标 workspace 对象 → `await setWorkspace(目标)` → 完成后再 `focusConversationById`。**顺序必须先切后高亮**，否则高亮联动用旧工作区查会话丢失。「切换了会话 → 左右同步到它的工作区」由此联动天然保证：右栏（WorkspaceExplorer / AdditionalFilesPanel / TopicPanel 读全局）零改动即正确

### 右栏取舍（调研后修订）

原设计「右栏数据源 = 焦点 tab 的 workspaceId」需把 WorkspaceExplorer 的十来个隐式依赖全局 workspace 的操作全部参数化（建夹/改名/移动/删除/复制/打开位置/附加路径），回归面大。修订为：

- 右栏继续读全局工作区（零改动）。常态下全局 = 焦点工作区（联动保证），用户要求的「切会话必同步左右」完整满足
- **临时态**（浏览 B、焦点 A）时右栏显示 B 的文件——此时从右栏（WorkspaceExplorer / AdditionalFilesPanel）引用文件/文件夹进焦点会话会路径错乱：加引用校验，被引用项所属工作区 ≠ 焦点 tab.workspaceId 时 toast 拒绝
- 附加面板 `AdditionalFilesPanel` 已有 workspaceId props，校验逻辑同理覆盖其引用入口
- 未来若用户觉得临时态右栏别扭，可单独做「右栏 props 化」，不阻塞本设计

### 排除的选项

- **点 tab 切全局工作区（旧交互）**：状态割裂、体验闪换，用户否决
- **左侧列表显示所有工作区的会话**：左侧空间小、混排乱、工作区级操作按钮无处安放，用户否决
- **所有会话打工作区标记混排**：乱，否

## 模块边界

### 前端

| 文件 | 改动 |
|------|------|
| `components/agent-chat/AgentChat.tsx` | 新增可选 props `workspaceId`，传给三个 hooks；缺省回落全局 store |
| `components/agent-chat/hooks/useAgentSession.ts` | attach 的 workspaceId 改从参数取（`:52`） |
| `components/agent-chat/hooks/useTopicArchiveState.ts` | workspaceId 改从参数取（`:13`）；依赖数组删掉全局 workspaceId，getById/getGroup 用 tab.workspaceId |
| `components/agent-chat/hooks/useMessageHistory.ts` | 拉历史的 workspaceId 改从参数取（`:38`） |
| `app/page.tsx` | AgentChat 渲染处从 `tab.workspaceId` 传入（仅此一项；右栏三面板零改动，见「右栏取舍」） |
| `components/WorkspaceTabBar.tsx` | `handleTabClick` 删除「跨工作区先 setWorkspace / 找不到 toast」整套逻辑，直接 `switchTab`（联动由订阅接管） |
| `stores/conversation-store.ts` | 底部 activeTabId 订阅 async 化：先工作区同步后高亮（焦点联动唯一入口） |
| `stores/reference-store.ts` | 引用会话数据结构补 `workspaceId` 字段 |
| `components/conversation-list/ConversationRow.tsx` | 引用按钮存入 workspaceId；右栏引用校验不改此文件（校验在 Explorer/AdditionalFilesPanel） |
| `components/WorkspaceExplorer.tsx` / `components/AdditionalFilesPanel.tsx` | 引用入口加校验：被引用项工作区 ≠ 焦点 tab.workspaceId → toast 拒绝 |
| `components/agent-chat/hooks/useSendMessage.ts` | `:368` 注入的 `<conversation>` 标签带 `workspaceId` 属性 |
| `app/session-window/page.tsx` | 从 init 的 `result.workspaceId` 传入 AgentChat props（数据流统一，不依赖全局） |

### 后端

| 文件 | 改动 |
|------|------|
| `electron/main/agents/tools/reference-tools.ts` | `dogear__ReadReferenceSession` 加可选 `workspaceId` 参数：不传按当前会话工作区（兼容现状），带则按目标工作区定位 session 文件（`readCleanTranscript(workspaceId ?? 默认)`） |
| `electron/main/agents/session-append-templates.ts` | 引用注入说明（REFERENCE_APPEND 段）补一句：引用的会话可能属于其他工作区，读取时把标签里的 workspaceId 传给工具 |

不改动：agent 工具的 workspaceId 绑定（本来就按 `conversation.workspace_id`）、微信 bot attachment、后端 session 生命周期。

## 数据流

**点 tab（可能跨工作区）**：
`switchTab → activeTabId 变化 → conversation-store 订阅：tab.workspaceId ≠ 浏览工作区 → await setWorkspace(目标)`（左侧列表/组数据异步加载，分片镜像同步切换）`→ focusConversationById`（分片未加载完时 getById 兑底）`→ 右栏读全局自动同步`。聊天区立即可见（AgentChat 一直挂载）。

**顶部切换器**：
`setWorkspace(目标) → 左侧列表换成目标工作区`；焦点 tab 不动、已挂载 AgentChat 无事件（workspaceId 恒为 tab 值）；右栏显示浏览工作区文件（引用入口有校验兑底）。

**已挂载 AgentChat（切换全程）**：
workspaceId 恒为 tab.workspaceId → 三个 hooks 无 effect 重跑 → 无 detach。

**跨工作区引用**：
浏览列表（B）右键引用 → reference-store 存 `{conversationId, sessionId, workspaceId: B}` → 焦点会话 X（A）发送 → 标签 `<conversation ... workspaceId="B">` 注入 → agent 派子会话消化 → 子会话 `dogear__ReadReferenceSession(sessionId, workspaceId: "B")` → `readCleanTranscript(B, sid)` 命中。

## 错误处理 / 边界情况

1. **话题状态重查**：`useTopicArchiveState` 依赖里的 `groups` 在切换时被新工作区覆盖 → effect 重跑，但查询用 tab.workspaceId，结果正确；输入区短暂闪「正在检查话题状态…」；`archived` 全程 false，`useAgentSession` 不重跑不 detach
2. **左侧高亮联动**：`focusConversationById` 在联动 setWorkspace 之后执行（分片切换是同步 set），分片首次加载为空时已有 getById 兜底
3. **真删工作区**：点 tab 无任何切换逻辑（分支已删，不再弹「目标工作区不存在」）；挂载的 AgentChat 重查 getById 失败 → 显示「已删除」只读态（真实态，合理），tab 由用户手动关
4. **临时态文件引用**：右栏显示浏览工作区，引用入口校验拦截跨工作区引用 → 焦点会话收到的文件引用永远属于自己工作区，agent 路径解析不会错乱
5. **首页 tab**：无焦点会话 → 右栏回落显示浏览工作区
6. **独立窗口 / 微信 bot / debug 页**：独立窗口是独立渲染进程 + init 时已定位工作区，传 props 即可；bot 的 attachment holder 与 desktop 分离；debug 页用 props 缺省回落全局，零改动兼容
7. **新建会话**：左侧列表顶部按钮 → 归属浏览工作区；临时态下在 B 列表新建 → 建 B 会话并聚焦 → 联动把左右同步到 B，行为自然

## 验收路径

1. A 工作区会话跑长任务 → 顶部切到 B → tab 不报「已删除」、状态灯还闪 → 点回 tab → agent 仍在跑、流式内容连续、权限等待卡片原样
2. 焦点是 A 的会话，切浏览到 B → 左侧变 B 列表、右侧文件树仍 A、聊天仍 A → 右键 B 会话引用 → 芯片进 A 会话 → 发送 → agent 能读到 B 会话原文
3. 点 B 列表会话 → 左右同步到 B，焦点 tab 是新会话
4. 关掉 B tab、点 A tab → 左右同步回 A

## 调研结论（联动风险清单）

1. **焦点联动时序**：高亮联动（focusConversationById）与工作区同步的顺序必须「先切后高亮」——已并入 conversation-store 订阅 async 化，单点保证
2. **useMessageHistory**：effect 仅依赖 `[conversationId]`，切工作区不重拉历史、messages 不闪空；workspaceId 仅作闭包变量，改 props 后首次拉取直接正确
3. **onLiveSnapshot 引用稳定性**：`applyLiveSnapshot` useCallback 包裹且依赖稳定 → `useAgentSession` effect（依赖含 onLiveSnapshot）不会无故重跑，无意外 detach
4. **右栏零改动取舍**：见「右栏取舍」段；WorkspaceExplorer 十余个隐式全局依赖操作不动，回归面最小化
5. **props 回落兼容**：`workspaceId ?? 全局` 写法对 debug 页零破坏；tab 场景 effectiveWsId 恒为 tab 值，全局变化不影响 → 无重跑
6. **顺带修复**：现状「切工作区后首次点开 tab 的挂载竞态」（全局 workspace 未就绪导致 attach/拉历史用错工作区）因 tab 携带 workspaceId 自然消失
7. **sessionRestartTrigger 全局广播**：现状如此（跨 profile 换模型触发全部会话重建），非本次改动引入，不动

## 未决问题（已解决，实施时按此执行）

- `setDefault` 时机：联动自动 setWorkspace 保持 setDefault（「最后活跃工作区 = 下次启动默认」）
- 焦点联动位置：并入 conversation-store 底部 activeTabId 订阅（与高亮联动同处，单点维护时序）

## 未来扩展（本次不做）

- 跨工作区引用会话列表 UI 增强（如引用芯片显示所属工作区徽标）
- 话题面板跟随焦点会话的 groupId 精确定位（现在 currentGroupId 依赖全局分片查找，跨工作区 tab 时为 null，可后续补）
