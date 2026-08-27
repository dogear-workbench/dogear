# 左侧列表子会话折叠 + 按钮叠放 设计

**日期**：2026-08-27

## 背景

多 agent 使用频繁后，子会话在左侧列表平铺占满组内空间，而子会话基本不看。同时会话行/话题行的 hover 按钮是 flex 固定占位（`w-6`），标题文字从未打满。子会话顶部还有一条「由 XXX 派出：task」的溯源条（LineageBar），与左侧列表信息重复。

## 目标

1. 组内主会话与子会话合并成树形单元：子会话默认折叠在派出者行下，点箭头可展开。
2. 删除子会话顶部的 LineageBar（左侧列表展开层级成为子会话归属的唯一信息来源，已确认接受）。
3. 会话行/话题行按钮改为 absolute 右侧浮层：文字打满，hover 时浮现，且不产生误触。

## 架构

**树形折叠（方案 A）**：`sortConversationsWithDFS` 改造为 `buildConversationTree(conversations): Array<{ conv: Conversation; children: Conversation[] }>`。排序规则原样保留（root 按 `updated_at` 倒序、children 按 `created_at` 升序、孤儿子会话回落 root 自然序）。GroupCard 接收树形结构渲染：root 行 indent 24，children 行 indent 40；有子会话的 root 行在图标左侧常显 ChevronRight/Down 小箭头，点击 stopPropagation 切换折叠（不影响点行打开会话）。

排除的选项：方案 B（子会话完全不渲染、仅计数徽标）——列表更干净但失去查看子会话的直接入口，需另建通道，不取。

**按钮叠放**：行容器 `relative`，标题区 flex-1 打满；按钮组 `absolute` 右侧浮层，默认 `opacity-0 pointer-events-none`（防隐形误触），`group-hover` 及菜单 `data-[state=open]` 态恢复 `opacity-100 pointer-events-auto`；按钮下垫透明→背景色渐变让标题尾部自然淡出。点击隔离依赖已有 `stopPropagation`。

**LineageBar 删除**：删组件文件与 AgentChat 挂载点、lineageParent 派生逻辑。

## 模块边界

| 文件 | 改动 |
|------|------|
| `lib/conversation-sort.ts` | `sortConversationsWithDFS` → `buildConversationTree`，返回树形结构 |
| `components/conversation-list/ArchiveSection.tsx` / `ManualSection.tsx` / `RecentVirtualGroup.tsx` / `SmartSection.tsx` | 改调 `buildConversationTree`，传原始过滤列表 |
| `components/group-list/GroupCard.tsx` | conversations prop 类型改树形；渲染 root + 折叠 children；头部按钮叠放 |
| `components/conversation-list/ConversationRow.tsx` | 加 `expandToggle?: { expanded: boolean; onToggle: () => void }`（图标左侧箭头）；按钮叠放 |
| `stores/section-collapse-store.ts` | 加 `subExpandedConvIds: Set<父会话 conversation.id>`（默认空 = 全折叠）+ `toggleSubExpand` / `expandSubConv` |
| `stores/conversation-store.ts` | `focusConversationById` 补联动：目标是 agent 子会话且父在当前列表时展开父折叠区（否则切到子会话 tab 时高亮被折叠藏住） |
| `components/agent-chat/AgentChat.tsx` | 删 LineageBar import（:19）、lineageParent 计算（:71-73）、挂载（:385 附近） |
| `components/agent-chat/LineageBar.tsx` | 删除文件 |

## 数据流

- 列表渲染：section 过滤组内原始列表 → `buildConversationTree` → GroupCard → root 行（ConversationRow，indent 24 + 可选箭头）→ 展开时 children 行（indent 40）。
- 折叠状态：箭头点击 → `toggleSubExpand(父 conv.id)`；四个 section 共用同一状态源。
- tab 联动：`focusConversationById`（切 tab / 关 tab 回退 / 独立窗口收回）→ 现有 `revealTopicInList` 不变 → 追加：目标会话 `contractMetadata.createdBy === 'agent'` 且按 `parentSessionId` 能在 conversations 里找到父 → `expandSubConv(父 conv.id)`。

## 错误处理 / 边界情况

- 孤儿子会话（父已删 / 不在同组）→ 回落 root 自然序，沿用现有逻辑。
- 子会话运行中但折叠 → 主行 `childSnapshot` 的 StatusPulse 已覆盖，无需新增。
- 归档视图（readOnly）：树形 + 折叠同样生效，箭头可用（查看历史需要）。
- 行处于重命名编辑态（isEditing）→ 隐藏按钮浮层，避免盖住输入框。
- 按钮浮层 `pointer-events-none` 必须与 `opacity-0` 成对出现，防「看不见但点得到」。
- GroupCard 头部 `+` / `...` 两个按钮与右侧计数徽标同处浮层区，hover 时计数被渐变盖住属预期。

## 未决问题

- 渐变底色在选中行（蓝底）上有轻微色差，视觉验收不过则换 VSCode 式悬浮工具条（自带背景 + 圆角 + backdrop-blur）。
- GroupCard 计数徽标被浮层盖住的观感，实施时验收。
