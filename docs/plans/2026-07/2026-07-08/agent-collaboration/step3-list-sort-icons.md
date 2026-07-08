---
step: 3
title: 列表排序 + 图标区分
status: done
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

**与计划差异**：
- 计划里三个 Section 的 `role !== 'sub'` 过滤原本没提要动——实施中发现：不去掉这个过滤，agent 会话根本不会进扁平列表，DFS 排序就是排一个空集。同时 `ConversationRowWithChildren` + `ChildConversationRow` 是旧 DelegateTo 时代从内存态 `childrenByParent` 额外渲染嵌套子行的产物，跟 plan.md 「会话平摊到组，不引入父子树」的架构直接冲突。所以本 step 顺带把这两个组件删除、三个 Section 的 `role='sub'` 过滤去掉，agent 会话现在作为平级成员进入 conversations 列表并通过 DFS 排序紧跟派出者。
- 排序放在**渲染层**（各 Section 传入 GroupCard 之前调用），不放在 store 层——因为 store 是全工作区扁平列表，而 DFS 排序只在同组内有意义，按 groupId 分组后各自排序更自然。

**改动文件清单**：
- 新建 `lib/conversation-sort.ts`
- 删除 `components/conversation-list/ChildConversationRow.tsx`
- 删除 `components/conversation-list/ConversationRowWithChildren.tsx`
- 改 `components/conversation-list/ConversationRow.tsx`：图标分支加 `isAgentConversation`（`Bot`），保留 `isRunning`（`StatusPulse`）→ `isFork`（`GitBranch`）→ `isAgent`（`Bot`）→ 默认（`MessagesSquare`）优先级
- 改 `components/conversation-list/SmartSection.tsx`：去掉 `role !== 'sub'` 过滤 + 用 `sortConversationsWithDFS` 排序
- 改 `components/conversation-list/TimeSection.tsx`：同上
- 改 `components/conversation-list/ManualSection.tsx`：同上
- 改 `components/conversation-list/RecentVirtualGroup.tsx`：同上
- 改 `components/group-list/GroupCard.tsx`：调用点从 `ConversationRowWithChildren` 换为 `ConversationRow`

### 给下一步的接力棒

- **关键签名**：`sortConversationsWithDFS(conversations: Conversation[]): Conversation[]`，位于 `lib/conversation-sort.ts`。纯函数、输入不可变、返回新数组。算法：按 `updated_at` 倒序作为基础顺序 → 建 `sdk_session_id` 索引 → 分类根/子（子 = `contractMetadata.createdBy==='agent'` 且 `parentSessionId` 能在当前列表中找到）→ 子按 `created_at` 升序排列并挂在派出者 `sdk_session_id` 下 → 从根节点开始 DFS 展平。孤儿 agent 会话（派出者已删除或不在同组）自动回落自然时间序（作为根节点被访问）。
- **排序在渲染层**：Step 4 溯源条要跳转到派出者会话，可以直接读 `conversation.contractMetadata.parentSessionId`，然后用 conversation-store 的 `conversations` 找 `c.sdk_session_id === parentSessionId` 的那条即可。不需要依赖排序后的结构。
- **本 step 暂时移除的视觉能力**（不影响 Step 4/5，只是记录状态）：
  - 旧 `ChildConversationRow` 的 `CornerDownRight` 缩进指示——DFS 排序后 agent 会话紧跟派出者已达到视觉聚拢效果，缩进这个视觉元素本次未替代，如后续觉得需要可在 Step 4 溯源条或独立 UI 迭代里补
  - 旧组件里给 sub 会话专门的 running/done/failed 徽章（源自 bridge.childStates 内存态）——`ConversationRow` 通过 `runningConversationIds` 保留了运行中动效（StatusPulse），但 done/failed 的终态徽章没了；如需要，Step 4 溯源条可以承载
- **已知限制**：
  - 智能分类 / 时间视图下 DFS 排序**同样在组内生效**——因为都通过 GroupCard 渲染，`sortConversationsWithDFS` 在 SmartSection/TimeSection/RecentVirtualGroup/ManualSection 四处都被调用了
  - 孤儿 agent 会话（父会话已删除 / 不在同一组）在当前实现里回落为根节点、按 `updated_at` 倒序参与自然排序，符合 plan.md 「派出者不在当前列表 → agent 会话回落自然时间序」的决策
