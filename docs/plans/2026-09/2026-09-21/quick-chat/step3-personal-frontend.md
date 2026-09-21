---
step: 3
title: 临时会话前端
status: done
---

## 目标

左侧列表顶部「临时会话」分区（当天/更早折叠）、分区「+」与 Ctrl+Alt+N 入口、会话可开 tab 聊天（最小能力包），完整走通「随手问」。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 2 personal 后端就绪（目录自愈、getAll 过滤、7 天归档、单会话组）；Step 1 registry 有 `quick-chat-new` 条目待接线
- 关键现状签名：
  - 列表：`components/ConversationList.tsx` + `conversation-list/`（分区：近期<7天/更早/归档 tab；`RECENT_THRESHOLD_MS` 在 `stores/group-store.ts`）；列表刷新统一走 conversationListChanged 事件回环
  - 会话数据：`stores/conversation-store.ts`（conversations/选中/四个运行态 Set 唯一订阅源是后端事件）
  - tab：`stores/session-store.ts` `openTab(conversationId, title, workspaceId)`；decouple 后 tab.workspaceId 是唯一权威来源，临时会话 tab 与工作区会话并存零事件
  - 能力包：`electron/main/agents/ability-registry.ts` `resolveAbilities`（overrides∩触发条件∩Profile 子开关）
- 关键决策回顾：前端平铺渲染 personal 的单会话组为普通会话行，不显示组概念；conversationListChanged 广播带 workspaceId=personal，前端按此路由到临时分区

## 计划改动

- [x] conversation-store：加载链路兼容 personal（现有按当前工作区拉取会话的路径，需评估是跟随当前工作区拉取还是额外拉 personal 列表——personal 分区需在所有工作区视图下常显，倾向于并行拉取 personal 列表独立存储）；分区状态（当天/更早折叠）沿用 section-collapse-store 模式 → 采独立存储 personalConversations，启动拉一次 + 广播路由刷新
- [x] `ConversationList.tsx` 顶部新增固定「临时会话」分区：当天（updatedAt 跨自然日）直接显示；1–7 天收进「更早」默认收起；单会话行平铺（复用 ConversationRow，隐藏组 UI 徽标）
- [x] 分区头部「+」：调 conversation 创建 IPC（personal + 单会话组）→ openTab 聚焦；Ctrl+Alt+N 接线 Step 1 的 `quick-chat-new` 条目 handler 同逻辑
- [x] 临时会话 UI 提示：会话顶部/输入框占位显示「临时会话」徽章，聊天下背景微弱色差（CSS 层面，AgentChat 判断 tab.workspaceId === PERSONAL_WORKSPACE_ID）
- [x] 能力包：resolveAbilities 对 personal 走最小集（基础工具+联网搜索/网页阅读），实现方式按 ability-registry 现有 overrides 机制（可能新增 personal 专用 override 入口），设置页能力包 UI 对 personal 的呈现方式回填记录 → 落为 workspace-config-service 的 personal 默认合并（见回填差异 1/2）
- [x] 系统提示词：personal 会话不注入工作区规则/记忆/项目上下文（session-append-templates 的条件注入按 workspaceId 判断跳过）→ 经 activeAbilities 最小集在拼装侧自然跳过（见回填差异 2）
- [x] 伴随面板：临时会话聚焦时文件树显示空态（跟随 workspaceId 自然为空，验证即可）→ WorkspaceExplorer 数据源是全局 store，改为 CompanionPanel 显式空态分支（见回填差异 4）
- [x] 归档 tab：personal 归档会话标记「临时」
- [x] `bun run lint` + 手动验收（lint/tsc/test 全绿；GUI 手动验收待 bun run dev）

## 验收

- [x] Ctrl+Alt+N / 分区「+」新建临时会话，直接开 tab 聚焦可聊天（代码链路验证：newPersonalConversation → createGroup+create → 预 attach → openTab；运行时 GUI 验收待 `bun run dev`）
- [x] 临时会话内 agent 无文件读写能力（workspacePath='' → basePaths 仅 configDir 顶层禁写，Step 2 已验证）、有联网搜索（personal 默认集 web-mcp 开，脚本验证）
- [x] 临时会话与工作区会话 tab 并存，互相切换不打断运行中会话（decouple 架构：tab.workspaceId 权威 + sessionId 发送；personal 行点击不写当前工作区分片）
- [x] 当天/更早分区正确（跨自然日）；归档 tab 合并 personal 归档且带「临时」标记，恢复/删除按 personal 路由
- [x] 工作区切换器、设置页不出现 personal（getAll 默认过滤，Step 2；本次未触碰相关路由）

## 实施回填（做完后填）

### 实际改动

#### 与计划差异

1. **能力包最小集走数据驱动而非改 resolveAbilities**：pi-session 调用点无法传 workspaceId，改在 `getWorkspaceConfig('personal')` 读取时合并 `PERSONAL_DEFAULT_CONFIG`（12 包 abilityOverrides 显式声明：项目/协作/记忆类全关 + web-mcp 开；enabledToolPacks 默认 ['web-mcp']；stored 显式值优先）。resolveAbilities / session-append-templates / pi-session 零改动，用户可用 workspaces/personal/config.json 逐包覆盖。
2. **「session-append-templates 条件注入按 workspaceId 跳过」未落到模板层**：通过 overrides 让 activeAbilities 只含 web-mcp，pi-session 拼装侧现有 `activeAbilities.has(...)` 判断自然跳过全部项目上下文段（等效达成，且不碰有他人未提交改动的 pi-session.ts）。global-rules/core-profile 一并关闭（最小集语义）。
3. **conversationListChanged 监听按 workspaceId 路由**：原监听无参消费；现 data.workspaceId==='personal' 时刷新独立列表；启动时额外主动拉一次。
4. **伴随面板**：page.tsx 原写死 workspace.id，改为活动会话 tab 的 workspaceId；文件树（WorkspaceExplorer）数据源是全局 workspace-store，「自然为空」不成立，改为 CompanionPanel 对 personal 显式渲染空态分支。
5. **计划外的必要扩展**：ConversationRow 加 workspaceId prop（重命名/删除路由）；conversation-store 的 deleteConversation/updateConversationTitle、group-store 的 restoreTopic/deleteTopic 加可选 workspaceId 参数（归档页 personal 话题操作路由）；conversation-list/utils 新增 openPersonalConversation（只开 tab，不写当前工作区分片的 selectedConversation 与 group-store.currentGroupId，避免污染）。

#### 设置页能力包 UI 对 personal 的呈现（回填）

personal 不在 getAll() 中 → 设置页能力包/工作区列表天然不出现 personal。personal 能力暂无 UI 入口：默认集由 workspace-config-service 合并逻辑提供，手工改 workspaces/personal/config.json 的 abilityOverrides 可逐包覆盖。未来加 UI 的挂点：设置页工作区能力 tab 的 getAll 枚举处显式拼入 personal 条目。

#### 改动文件清单

| 文件 | 改动 |
|---|---|
| electron/main/services/workspace-config-service.ts | PERSONAL_DEFAULT_CONFIG + getWorkspaceConfig 对 personal 合并默认（stored 优先） |
| stores/conversation-store.ts | personalConversations / loadPersonalConversations / newPersonalConversation / delete+title 加 workspaceId 路由 / 事件按 workspaceId 路由 / 启动加载 |
| stores/group-store.ts | restoreTopic/deleteTopic 加可选 workspaceId（非当前工作区时不写本地 groups store） |
| stores/section-collapse-store.ts | personalOlderExpanded / togglePersonalOlder |
| components/ConversationList.tsx | PersonalSection 常显（含空态）+ registerHotkey('quick-chat-new') |
| components/conversation-list/PersonalSection.tsx（新） | 临时会话分区：当天平铺 / 更早折叠（默认收起）/ 头部「+」 |
| components/conversation-list/utils.ts | openPersonalConversation |
| components/conversation-list/ConversationRow.tsx | workspaceId prop（重命名/删除路由） |
| components/agent-chat/AgentChat.tsx | isPersonal 顶部徽章条 + 容器背景色差 |
| app/page.tsx | CompanionPanel workspaceId 跟随活动会话 tab |
| components/companion/CompanionPanel.tsx | personal 文件树空态分支 |
| components/archive/types.ts + ArchivePage.tsx + ArchiveTopicList.tsx | 归档合并 personal + 「临时」标记 + digest/恢复/删除按 personal 路由 |

### 给下一步的接力棒

- 关键签名 / 数据结构：见 step3-delivery.md（共享区）
- personal 能力边界生效路径：attach('personal') → getWorkspaceConfig 合并 → resolveAbilities 只含 web-mcp → group-context/agent-collab 段与工具不挂载、文件边界空
- 已知限制：① dogear-memory 工具仍注册（pi-session 无工作区兑底分支），要彻底排除需改 pi-session.ts（有他人未提交改动，本 step 未动）；② WEB_RESEARCH_GUIDANCE_MAIN_APPEND 注入含「派浏览器子会话」指引但 personal 无派遣工具（提示词轻微超配）；③ 归档页 personal 条目在 7 天 timer 触发时不即时刷新（依赖 groups 变化/切工作区）；④ 移入工作区（importConversation + session JSONL 搬运）未实现，属后续 step
- 运行时手动验收（GUI）待 bun run dev：新建/聊天/分区折叠/归档标记/与工作区 tab 并存回归
