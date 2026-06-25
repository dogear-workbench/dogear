---
step: 3
title: 组列表 UI（新增视图）
status: done
---

## 目标

新增 GroupList 视图作为左侧列表的**默认视图**，组卡片可展开看会话列表。**手动/智能/时间视图全部保留，作为可切换视图**——风险最小路径。完成后用户能看到"组卡片 → 展开看到内部会话"的层级。

## 依赖上下文（执行时填）

- 前置 step 产出：[step2] group-store API / IPC API / conversation-store 新签名
- 当前关键文件状态：执行前读 `components/ConversationList.tsx`（主骨架）/ `components/conversation-list/ViewTabs.tsx`（视图切换器）/ `components/conversation-list/ConversationRow.tsx`（行渲染参考）/ `components/conversation-list/utils.ts`（openOrFocusConversation 等共用函数）
- 关键决策回顾：plan.md「渐进式 UI 改造原则」——**不删除**现有视图组件

## 计划改动

### 新增组件目录 `components/group-list/`
- `GroupList.tsx`：容器，按 group-store 渲染卡片，按 `group.updatedAt` 倒序
- `GroupCard.tsx`：单个组卡片
  - 头部：标题（按 fallback 推导规则显示：单会话用 conversation.title / 多会话用首会话 title + "等 N 个"角标 / 有 group.title 优先用）+ 最后活动时间 + 角标（等 N 个交付/粘性等，P1 暂留占位）
  - 展开/折叠按 `expandedGroupIds`
  - 展开后渲染组内 conversation 列表（复用 `ConversationRow`，给个 `variant="in-group"` 让缩进/样式微调）
  - 右键菜单：改名、删除组、新建组内会话
- `GroupRow.tsx`（可选，如果 ConversationRow 复用即可就不建）
- `utils.ts`：组标题推导函数 `deriveGroupTitle(group, conversations)`

### 视图切换器扩展
- 修改 `components/conversation-list/ViewTabs.tsx`：
  - 新增 `'group'` 视图选项，放在最左侧
  - **默认值改为 `'group'`**（旧用户进来直接看到组视图）
  - 其他选项（smart/time/manual 通过手动文件夹入口）保持

### 主骨架适配
- 修改 `components/ConversationList.tsx`：
  - view === 'group' 时渲染 `<GroupList />`
  - 其他视图保持原逻辑（SmartSection/TimeSection/ManualSection/ArchiveSection）
  - Toolbar 适配：组视图时"新建对话"按钮变成"新建组并新建对话"或"在选中组里新建对话"（看选中状态）

### 新建会话流程
- 改 `components/conversation-list/Toolbar.tsx`：
  - 组视图下点"新建对话"：
    - 若有 `currentGroupId`：在该组下创建 conversation
    - 若没有：先 createGroup（无标题）再创建 conversation 写入该组
  - 触发后自动展开该组并选中新会话
- "新建组"按钮：组视图下显示（旁边或单独菜单），无标题创建空组

### 选中 + 高亮逻辑
- `useNodeHighlight` 复用：组视图下 nodeId 仍是 `conversationId`，选中/打开高亮规则不变
- 选中某 conversation 时同步 `setCurrentGroup`（Step 2 已做）

### 行按钮简化（顺手优化，与本 step 一起做）
- 修改 `components/conversation-list/ConversationRow.tsx`：
  - 移除原有的"编辑/引用/删除等" hover 按钮组
  - 改为单个 `···` 按钮（lucide `MoreHorizontal` 图标）
  - 点击 `···` 按钮 → 触发与右键 ContextMenu **完全相同**的菜单（提取 ContextMenu 内容为可复用片段，按钮点击和右键都打开它）
- 同样规则应用到新建的 `GroupCard.tsx`（组卡片头部也只放 `···` 按钮）
- 验证：标题区视觉变干净，所有原功能（编辑/引用/删除/加文件夹/智能分类等）仍可通过 `···` 或右键访问

### 删除/改名
- GroupCard 右键删组：调用 `client.deleteGroup`，组内有会话时弹 confirm「组内还有 N 个会话，无法删除。先把会话删掉？」
- 组改名：弹 confirm-store 输入框 → `updateGroup({ title })`

## 验证

- `bun run dev` 启动后：
  - 左侧默认显示组视图，每个组卡片对应迁移前的一个 conversation（单会话组）
  - 点卡片展开能看到组内会话，点会话能正常打开
  - "新建对话"按钮工作：新建一个空组 + 内含一条新会话
  - 视图切到 smart/time 还能正常看
  - 选中一个会话，再切回组视图，相应组自动展开 + 高亮
- 旧手动文件夹/智能分类视图功能 100% 保持

## 实施回填（做完后填）

### 实际改动

按计划分两段（3a + 3b）落地，与计划基本一致：

**3a：ConversationRow ··· 按钮简化**
- `components/conversation-list/ConversationRow.tsx`：
  - 移除 Quote / Pencil / Trash2 三个 hover 按钮
  - 替换为单个 `MoreHorizontal` 按钮，点击 dispatch `contextmenu` MouseEvent 到 ContextMenuTrigger，直接复用现有 ContextMenu —— 不引入 DropdownMenu，AddToFolderMenu / MoveToFolderMenu / useReferenceStore 全部零改动
  - 按钮 class 含 `data-[state=open]:opacity-100`，菜单打开时按钮持续可见
- archived 行无 ··· 按钮（原本就没 hover 按钮，保持一致）

**3b：GroupList + ViewTabs + Toolbar**
- 新建 `components/group-list/utils.ts`：`deriveGroupTitle(group, conversations)` 纯函数
- 新建 `components/group-list/GroupCard.tsx`：折叠头（ChevronRight/Down + Layers 图标 + 标题 + 会话数 + ···）+ ContextMenu（重命名/在组内新建/删除组）+ inline rename input
- 新建 `components/group-list/GroupList.tsx`：按 `group.updatedAt` 倒序渲染 GroupCard，空态「暂无会话组」
- `components/conversation-list/ViewTabs.tsx`：ListView 加 `'group'`，Tab 列表加「组」放最左（Layers 图标）
- `components/ConversationList.tsx`：默认 view 改成 `'group'`，渲染分支加 group 分支，import GroupList
- `components/conversation-list/Toolbar.tsx`：「新建对话」按 currentGroupId 分流（有则 `client.create({ groupId })` + 自动展开 + selectConversation；无则沿用 `newConversation()`），文案动态切「新建对话/在当前组新建」；新增「新建组」按钮（FolderPlus，调 `createGroup()` + setCurrentGroup）

### 给下一步的接力棒

- **GroupCard props**：`{ group: Group; conversations: Conversation[] }`
- **GroupList props**：`{ workspaceId: string }`（实际未用，预留——group-store 已由 conversation-store.loadConversations 预热）
- **Toolbar 新行为**：
  - currentGroupId 存在：按钮文案「在当前组新建」，点击在该组内创建 + 自动展开
  - currentGroupId 为空：按钮文案「新建对话」，沿用 `newConversation()`（IPC 内部自动 createGroup）
  - 「新建组」按钮（FolderPlus）始终显示，无标题创建空组并设为 current
- **nodeId 约定**：组视图内的 ConversationRow 用 `group:${group.id}:${conv.id}`，避免与其他视图节点 id 冲突，`useAppearanceCount` / `useNodeHighlight` 自然兼容
- **组标题推导**：`deriveGroupTitle` —— group.title 非空且非「新对话」优先；否则取首会话标题；多会话加「等 N 个」；空组「空组」
- **待办或已知限制**：
  - 「在当前组新建」流程中 `selectConversation` 和 `openOrFocusConversation` 都会触发 openTab，依赖 openTab 防重逻辑（utils.ts 注释提到）；功能正确但有轻微调用冗余，后续可清理
  - GroupCard 头部点击会同时 `toggleExpand` + `setCurrentGroup`，折叠后 currentGroupId 仍指向该组（Toolbar 文案保持「在当前组新建」）—— 设计为侧栏上下文记忆与展开状态解耦
  - 删除组在「组内有对话」时 group-store 已 toast.error 提示，未做「先把对话删掉？」二次引导确认（计划提及，P1 简化）
  - 「···」按钮通过 dispatch contextmenu 复用 ContextMenu，鼠标位置不在按钮正下方而是 trigger 元素相对位置 —— 视觉上菜单仍在合理范围，已接受
  - Toolbar「新建组」按钮始终显示，不限组视图 —— 简化决策，若后续打扰可加视图门控
