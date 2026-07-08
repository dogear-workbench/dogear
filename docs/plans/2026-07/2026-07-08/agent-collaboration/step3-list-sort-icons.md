---
step: 3
title: 列表排序 + 图标区分
status: pending
---

## 目标

组内会话列表按 DFS 顺序排列（agent 会话紧跟派出者），`ConversationRow` 根据 `contractMetadata.createdBy` 换图标区分手动会话（MessagesSquare）和 agent 会话（Bot）。

## 依赖上下文（接力棒输入）

- **Step 1 产出**：
  - `Conversation.contractMetadata` 字段可用
  - Agent 派出的会话有 `contractMetadata.createdBy = 'agent'` 和 `parentSessionId`

- **关键决策回顾**：
  - 排序：手动会话按时间倒序 + agent 会话按 DFS 紧跟派出者
  - 派出者不在当前列表 → agent 会话回落自然时间序
  - 完成状态不视觉区分
  - 图标：MessagesSquare（手动）/ Bot（agent）

## 计划改动

### 排序纯函数

- [ ] 新建 `lib/conversation-sort.ts`：
  - 导出 `sortConversationsWithDFS(conversations: Conversation[]): Conversation[]`
  - 算法：
    1. 按 `updatedAt` 倒序作为基础顺序（跟当前行为一致）
    2. 建 `Map<sdkSessionId, Conversation>` 便于查找
    3. 分类：
       - 根节点 = 手动会话 OR `parentSessionId` 找不到对应会话（孤儿）
       - 子节点 = agent 会话且 `parentSessionId` 存在
    4. 从根节点开始 DFS：每访问一个节点，把它 push 到结果，然后递归访问它的直接子（`parentSessionId === this.sdkSessionId` 的所有 agent 会话）
    5. 子节点内部按 `createdAt` 升序（保持派出顺序）
    6. 孤儿 agent 会话按 `updatedAt` 倒序混在根节点里
  - 输入不可变，返回新数组

### Store 集成

- [ ] `stores/conversation-store.ts`：
  - `loadConversations` 从 tipc 拿到原始列表后，用 `sortConversationsWithDFS` 排序
  - 之后所有下游（列表渲染、组内会话计数）都用排序后的
  - **注意**：这个排序影响的是"组内"的顺序。当前是不是按 group 分层的？如果是，DFS 排序只在同一 group 内进行——需要按 groupId 分组后各自排序，再合并。看清楚 conversation-store 现在的数据流再定
  - 如果排序需要在 store 之外（比如渲染时才排），也可以在 `conversation-list/GroupCard.tsx` 或 `TimeSection.tsx` / `SmartSection.tsx` 里用

### UI 图标

- [ ] `components/conversation-list/ConversationRow.tsx`：
  - 现在 row 应该有个图标（可能是通用 icon 或没有）
  - 根据 `conversation.contractMetadata?.createdBy` 判断：
    - `'agent'` → `Bot` (lucide)
    - 其他（`undefined` 或 `'human'`） → `MessagesSquare` (lucide)
  - 图标位置紧靠标题左侧，尺寸跟随现有样式（14/16px）
  - 图标颜色跟随现有主题（`text-muted-foreground` 或类似）

- [ ] 检查是否要在 `SmartSection.tsx` / `TimeSection.tsx` / `ManualSection.tsx` 三处都能生效——ConversationRow 应该是共用的，改一处即可

### 兼容性

- [ ] 旧的手动会话（`contractMetadata` 为空）自然走 MessagesSquare 分支
- [ ] 智能分类 / 手动文件夹 / 归档等场景下，agent 会话也要正常显示
- [ ] Smart Section 按 groupIds 排序，Time Section 按时间分桶——DFS 排序在**组内**生效，不改变智能分类/时间桶本身

## 验收标准

- [ ] `bun run build:electron` + `bun run lint` 通过
- [ ] 手测（造一个 agent 会话场景）：
  - Agent 派出的会话在列表上紧跟派出者
  - 图标能明显区分手动 vs agent
  - 派出者被删除后，agent 会话回落到时间序位置（不再紧跟）
  - 智能分类和时间视图下 agent 会话也能显示图标（虽然 DFS 排序在这些视图下可能不生效或部分生效）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `sortConversationsWithDFS` 的实际签名和位置
  - 排序是在 store 层做还是渲染层做（Step 4 溯源条需要知道，因为要跳转到派出者会话）
- 待办或已知限制：
  - 智能分类 / 时间视图下 DFS 排序是否生效
