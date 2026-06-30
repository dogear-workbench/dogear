---
step: 6
title: 列表 UI 子会话可视化
status: done
---

## 目标

子会话在 ConversationList 里能看到：嵌套缩进 + 状态角标 + 父会话「等 N 个交付」角标 + 点击进入独立 tab。让用户从黑盒"agent 在自己派子会话"变成可观察可介入。

## 依赖上下文（接力棒输入）

- Step 2-5 后端能力齐备，bridge 已 emit `childStatusChanged` / `deliveriesAwaitChanged`
- 现有列表组件：`components/ConversationList.tsx` 是骨架，`components/conversation-list/` 下子组件
  - `ConversationRow.tsx` — 通用行，所有 section 复用
  - 各 section（ManualSection / SmartSection / TimeSection 等）按视图分流
- 现有对话节点高亮 / 选中机制走 `lastFocusedNodeId` + `useNodeHighlight`
- 子会话只在"时间视图 / 智能视图 / 手动文件夹"里以缩进出现，**不参与**智能分类/手动文件夹本身（子会话隶属父会话，不该独立成块）

## 计划改动

### 1. `stores/conversation-store.ts`
- 加：`childrenByParent: Record<string, ChildStateSnapshot[]>` 状态
- 监听 `childStatusChanged` IPC 事件：更新对应 parentConversationId 下的 child 列表
- 加 selector：`getChildren(parentConversationId) → ChildStateSnapshot[]`、`getAwaitCount(parentConversationId) → number`（status='running' 计数）

### 2. `electron/main/tipc/agent.ts`（或新建 `delegation.ts`）
- 加 RPC `listChildren(parentConversationId): ChildStateSnapshot[]` — 给前端"冷启动"时拉一次现状用（事件只能补增量）
- conversation-store 加载对话列表时，对所有主会话调一次 listChildren 填初值

### 3. `components/conversation-list/ConversationRow.tsx`
- 接受新 prop：`indent?: number`（默认 0），渲染缩进
- 接受 `childStatus?: ChildStatus`，展示对应角标（emoji 或 lucide icon）：
  - running → 旋转的 Loader2
  - done → CircleCheck 绿
  - failed → CircleX 红
  - timeout → Clock 灰
  - cancelled → Ban 灰
  - no_delivery → AlertTriangle 黄
- 接受 `awaitCount?: number`（主会话才有），>0 时右上角展示 `⏳N` 角标

### 4. `components/conversation-list/`各 section
- 渲染时识别 `conv.role === 'sub' && conv.parentConversationId`：
  - 隐藏（不直接出现在 section 列表，靠 parent 展开）
  - 在 ManualSection / TimeSection 内的父行下方插入子行（indent=1）
  - SmartSection 也按此处理
- 父行渲染时通过 store.getChildren(parentId) 拿子会话列表，按 startedAt 顺序排
- 子会话节点 onClick：`openOrFocusConversation`（已有的工具函数，统一入口）走原 tab 打开逻辑

### 5. `stores/session-store.ts`（如需）
- 确认 openTab 对 sub conversation 没有特殊限制（无则不动）

### 6. 事件订阅
- `lib/events.ts` 或 conversation-store init 处订阅 `childStatusChanged` + `deliveriesAwaitChanged`
- 事件来了就 setState 触发 React 重渲染

### 7. 收尾：列表行按钮简化（设计文档「列表行按钮简化」一节）
- 这条本来是 Phase 1 顺手做的，如果 Phase 1 没做，本步顺便做：把行内 hover 的"编辑/引用/删除"折成单个 `···` 按钮等同右键
- **核对 Phase 1 实际是否做了**——如果做了就跳过这一项

## 验证

- `bun run build:electron` 通过
- `bun run lint` 通过
- 手测：
  1. 启 app，主会话派 2 个子会话
  2. 看列表：主会话节点出现「⏳2」角标，子会话缩进出现在下方，状态 = running（loader 转）
  3. 一个子会话调 SubmitDelivery → 该子节点变 ✓done，主节点角标变「⏳1」
  4. 另一个调用 timeout → 变 ⏱timeout，主节点角标消失
  5. 子会话点击 → 跳到独立 tab，能看到完整 chat，能手动插话
  6. 关掉 app 重启 → 子会话列表仍在（持久化的），但角标显示 cancelled/no_delivery（bridge 内存丢失，无活跃 state）

## 实施回填

### 实际改动

**与计划差异**：
- 不引入「按 parentConversationId 单独拉」的 IPC（计划里 listChildren），改用 `listAllChildren()` 一次性把 bridge 全部活跃/已 terminal 快照都拉回来。bridge 全局共享一个 childStates map，按工作区过滤反而要绕弯路；前端按 parent id 分组即可，少一次 N 倍 IPC。`listChildren(parentConversationId)` 也保留以备 Step 7 调试用
- 没用 selector，直接把 `childrenByParent: Record<string, ChildStateSnapshot[]>` 放到 store 顶层。组件用 `s.childrenByParent[parentId] ?? EMPTY` 读取
- 父行用一个新的 `ConversationRowWithChildren` 包装组件，内部调 `ConversationRow` 透传 `awaitCount`，再在下方平铺渲染 `ChildConversationRow`。**所有调用点（RecentVirtualGroup / TimeSection / SmartSection / ManualSection / GroupCard）都换成了 `ConversationRowWithChildren`**——不动 ConversationRow 调用签名，纯加强
- 时间视图/智能视图/近期/会话组列表都加了 `c.role !== 'sub'` 过滤；ManualSection 因为子会话不在树（树只渲染文件夹及其内容，根级散落对话被裁掉），不需要额外过滤
- 列表行按钮简化（计划第 7 项）**没做**——查仓库历史，b374e16 commit「共享区 UI 简化」已经做过 GroupCard 那一侧，conversation 行的按钮是 Phase 1 / 历史里早就保留下来的 hover 「···」，没多余按钮可折叠

**改动文件清单**：
- `electron/main/tipc/delegation.ts`（新建）：`listChildren(parentConversationId)` + `listAllChildren()`
- `electron/main/tipc/index.ts`：注册 `delegationRouter`
- `electron/main/agents/delegation-bridge.ts`：新增 `getAllChildren()` 返回所有快照
- `stores/conversation-store.ts`：
  - 新增 `childrenByParent` 状态 + 顶层初始值 + reset 清零
  - 新增 `refreshAllChildren` action（调 `client.listAllChildren` 按 parent 分组、按 startedAt 升序）
  - 新增 `applyChildSnapshot(snapshot)` action（upsert 单条）
  - `loadConversations` 末尾 fire-and-forget `refreshAllChildren()`
  - 模块初始化处订阅 `rendererEvents.childStatusChanged` → applyChildSnapshot
- `components/conversation-list/ConversationRow.tsx`：新增 `awaitCount?: number` prop，>0 时在标题右侧渲染 `⏳N` 琥珀色徽章
- `components/conversation-list/ChildConversationRow.tsx`（新建，76 行）：紧凑子行（CornerDownRight + 状态 lucide icon + 标题 + outputPath 副标），点击调 `openOrFocusConversation` 打开子会话 tab，复用 `useNodeHighlight` 做双层高亮
- `components/conversation-list/ConversationRowWithChildren.tsx`（新建）：从 store 订阅 children 并算 awaitCount，渲染 ConversationRow + 子行序列
- `components/conversation-list/RecentVirtualGroup.tsx`、`TimeSection.tsx`、`SmartSection.tsx`：filter `role !== 'sub'` + 用 `ConversationRowWithChildren`
- `components/conversation-list/ManualSection.tsx`：树叶节点（conversation）用 `ConversationRowWithChildren` 替换
- `components/group-list/GroupList.tsx`：filter `role !== 'sub'`
- `components/group-list/GroupCard.tsx`：用 `ConversationRowWithChildren` 替换

### 给下一步的接力棒

- **`childrenByParent` 实际数据结构 / 何时刷新**：`Record<string, ChildStateSnapshot[]>`，每数组按 `startedAt` 升序。三处刷新：① `loadConversations` 末尾后台调 refreshAllChildren ② `rendererEvents.childStatusChanged` 单条 upsert ③ 切工作区时不会自动清，但 reset() 会清——预期是切工作区先 reset 再 loadConversations 重新拉。bridge 视角 children 是跨工作区共享的（只关心 parentConversationId），所以切工作区不会丢
- **ConversationRow 缩进 / 角标具体 props 形状**：
  - `awaitCount?: number`（默认 0），>0 时在标题右侧渲染 `<span>⏳N</span>` 琥珀色徽章
  - 缩进保持原有 `indent?: number`（默认 8）不变
  - 没动 ConversationRow 的归档/编辑/onClick 等任何行为
- **重启后子会话状态的兜底显示策略**：bridge 内存丢失意味着 `listAllChildren()` 返回空。前端 `childrenByParent` 也是空，所以重启后子会话在列表里**完全不显示在父行下方**（无角标、无子行）。但 conversations.json 里的 sub conversation 仍存在，目前会被各 section 的 `role !== 'sub'` 过滤掉——意味着重启后子会话**从主列表彻底消失**（不可点开续聊）。**这是已知缺陷**，Step 7 或后续可以加「孤儿 sub 显示策略」：bridge 视角丢的子会话也在父行下方以 ❓状态显示，可点开续聊
- **列表行按钮简化是否本步做了**：没做。已检查 Phase 1 历史，没多余按钮可折叠
- **已知坑 / 待办**：
  - 子会话点击行为依赖 `conversations.find(c => c.id === childId)` 能找到 — 但 loadConversations 是 fire-and-forget，可能 child 已 startedChild 落库了但前端 conversations[] 还没刷新。临时折衷：找不到就什么也不做（不报错）。Step 7 加 chat UI 后可考虑加重试或自动 reload
  - 智能分类视图里子会话本来就不会被分类 agent 选中（categorize agent 看的是摘要卡），所以 SmartSection 的 sub 过滤其实是冗余 belt+suspenders
  - 子行不带右键菜单。如果用户想停止子会话只能去 chat UI 里调 StopChild（Step 7 加按钮）
  - `deliveriesAwaitChanged` 事件**目前没用到**（aggregate count 直接从 children 列表 derive 出来）。bridge 端仍 emit，留作日后用
