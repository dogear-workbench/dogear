---
step: 3
title: 临时会话前端
status: pending
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

- [ ] conversation-store：加载链路兼容 personal（现有按当前工作区拉取会话的路径，需评估是跟随当前工作区拉取还是额外拉 personal 列表——personal 分区需在所有工作区视图下常显，倾向于并行拉取 personal 列表独立存储）；分区状态（当天/更早折叠）沿用 section-collapse-store 模式
- [ ] `ConversationList.tsx` 顶部新增固定「临时会话」分区：当天（updatedAt 跨自然日）直接显示；1–7 天收进「更早」默认收起；单会话行平铺（复用 ConversationRow，隐藏组 UI 徽标）
- [ ] 分区头部「+」：调 conversation 创建 IPC（personal + 单会话组）→ openTab 聚焦；Ctrl+Alt+N 接线 Step 1 的 `quick-chat-new` 条目 handler 同逻辑
- [ ] 临时会话 UI 提示：会话顶部/输入框占位显示「临时会话」徽章，聊天下背景微弱色差（CSS 层面，AgentChat 判断 tab.workspaceId === PERSONAL_WORKSPACE_ID）
- [ ] 能力包：resolveAbilities 对 personal 走最小集（基础工具+联网搜索/网页阅读），实现方式按 ability-registry 现有 overrides 机制（可能新增 personal 专用 override 入口），设置页能力包 UI 对 personal 的呈现方式回填记录
- [ ] 系统提示词：personal 会话不注入工作区规则/记忆/项目上下文（session-append-templates 的条件注入按 workspaceId 判断跳过）
- [ ] 伴随面板：临时会话聚焦时文件树显示空态（跟随 workspaceId 自然为空，验证即可）
- [ ] 归档 tab：personal 归档会话标记「临时」
- [ ] `bun run lint` + 手动验收

## 验收

- [ ] Ctrl+Alt+N / 分区「+」新建临时会话，直接开 tab 聚焦可聊天
- [ ] 临时会话内 agent 无文件读写能力（让它读工作区文件应被拒），有联网搜索
- [ ] 临时会话与工作区会话 tab 并存，互相切换不打断运行中会话（回归 decouple 行为）
- [ ] 当天/更早分区正确；归档 tab 能看到超 7 天的临时会话且带「临时」标记
- [ ] 工作区切换器、设置页不出现 personal（回归）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
