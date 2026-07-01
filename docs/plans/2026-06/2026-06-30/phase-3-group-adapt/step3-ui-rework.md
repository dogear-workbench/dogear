---
step: 3
title: ConversationList 全面以组为主体
status: done
---

## 目标

ConversationList 三个 section（Smart/Time/Manual）统一以组卡片为渲染单元；手动文件夹装 groupId；组卡 header 持有组级操作，conversation 行保留原有引用/重命名/删除等。Step 3 完成后用户面已统一。

## 依赖上下文（接力棒输入）

- Step 1+2 落地后：
  - smart-category 数据结构已是 `groupIds[]`
  - 后端所有触发 / 工具 / 报告已组化
  - GroupCard 现有结构沿用：`components/group-list/GroupCard.tsx`（已实现展开后平铺 main 会话）
- 现状关键事实（来自调研）：
  - `ConversationList.tsx:1-85` 已有 view 三态 `'group' | 'smart' | 'time'`，默认 group；本 step 要去掉 'group' 分支，让 group 成为基础单元
  - `SmartSection.tsx:14-95` 当前按 `cat.conversationIds.map → ConversationRowWithChildren`
  - `TimeSection.tsx`、`ManualSection.tsx:141-340`、`ArchiveSection.tsx` 同上
  - `conversation-tree-service.ts:31-37` children 装 conversationId
  - `tipc/conversations.ts:370-406` folder IPC 三个 RPC 入参 conversationId
  - `ConversationRow.tsx:253` 含「添加到文件夹」ContextMenuItem + AddToFolderMenu / MoveToFolderMenu
  - `group-list/GroupCard.tsx:24-165` header + 展开渲染已就位

- 全局决策：会话基本操作（引用/重命名/删除）在组卡展开后的 ConversationRow 上**保留**；组级操作（重命名组/删除组/添加到文件夹）在 GroupCard header

## 计划改动

### ConversationList 主骨架

- [ ] `components/ConversationList.tsx`
  - 删除 view='group' 分支与 ViewTabs 中的 group 选项
  - ViewTabs 仅留 `smart | time | manual`（manual 现在是手动文件夹视图）
  - ManualSection 不再「始终先渲染」，改为 ViewTabs 切换里的一项
  - 默认 view 切到 manual 或 smart（用户偏好实施时定，推荐 manual——它是用户主动整理的视图）

- [ ] `components/conversation-list/ViewTabs.tsx`
  - 选项改为「手动 / 智能分类 / 时间」

### 三 Section 改组渲染

- [ ] `components/conversation-list/SmartSection.tsx`
  - `cat.groupIds.map`：拿对应 group → 渲染 GroupCard
  - 空 category 仍隐藏
  - 顶部 RecentVirtualGroup 也改为按组（按 group.updatedAt 取近 5 天内的组）

- [ ] `components/conversation-list/TimeSection.tsx`
  - 按 `group.updatedAt` 分桶：< 5 天放 RecentVirtualGroup（与 Smart 共用）；< 30 天 / 更早分两桶
  - 每桶 → GroupCard

- [ ] `components/conversation-list/RecentVirtualGroup.tsx`
  - 入参改 groups，渲染 GroupCard

- [ ] `components/conversation-list/ManualSection.tsx`
  - children 改装 groupId（数据已迁，仅前端展示侧改）
  - 行单元从 ConversationRowWithChildren 改 GroupCard
  - headless-tree 仍可用：节点类型 folder | group，叶子 = group

- [ ] `components/conversation-list/ArchiveSection.tsx`
  - 归档对象决策：保留按 conversation 归档 OR 按组归档？
    - **推荐**：保留按 conversation 归档（更细粒度），归档列表不变（按 conversation 渲染）；UI 上标注「归档单条会话」
    - 实施时若发现冲突再讨论

### 数据层 & IPC

- [ ] `electron/main/services/conversation-tree-service.ts`
  - `children[folderId]` 数据语义改为 `groupId`（数据已在 Step 1 迁完）
  - 内部纯函数：addGroupToTree / removeGroupFromTree / moveGroupBetweenFolders / migrateRootScatter（清理散落 groupId）
  - 旧函数名（addConversationToTree 等）保留但 deprecate 或直接改名

- [ ] `electron/main/tipc/conversations.ts`
  - IPC 改名+入参：
    - `addConversationToFolder` → `addGroupToFolder({ workspaceId, groupId, folderId })`
    - `removeConversationFromFolder` → `removeGroupFromFolder(...)`
    - `moveConversationBetweenFolders` → `moveGroupBetweenFolders(...)`
  - 前端 `lib/client.ts` 用法对齐

### ConversationRow（组卡展开后的 conversation 行）

- [ ] `components/conversation-list/ConversationRow.tsx`
  - 去掉「添加到文件夹」ContextMenuItem（上移到 GroupCard header）
  - 保留：引用 / 重命名 / 删除 / 编辑（基础会话操作）
  - 多选/AppearanceBadge 视情况调整（AppearanceBadge 原本统计 conversation 的多文件夹引用 + 多分类引用，现在改为统计**组的**多文件夹引用 + 多分类引用 → 这逻辑挪到 GroupCard header；ConversationRow 上的 AppearanceBadge 移除或保留只显示是否被打开）

- [ ] `components/conversation-list/AddToFolderMenu.tsx` → 删除
- [ ] `components/conversation-list/MoveToFolderMenu.tsx` → 删除

### GroupCard 增组级操作

- [ ] `components/group-list/GroupCard.tsx`
  - header 区新增 ContextMenu / `···` 按钮：
    - 重命名组（updateGroup({ title }))
    - 删除组（带二次确认，提示「会一并删除组内 N 个会话和共享区」）
    - 添加到文件夹（新菜单 AddGroupToFolderMenu）
    - 移动到文件夹（仅在文件夹内时显示，新菜单 MoveGroupToFolderMenu）
    - 引用整组（可选，后续 brainstorm；本 step 不做）
  - AppearanceBadge：显示组的多引用计数

- [ ] `components/conversation-list/AddGroupToFolderMenu.tsx`（新）
  - 多选 ContextMenuCheckboxItem，调 `addGroupToFolder` / `removeGroupFromFolder`

- [ ] `components/conversation-list/MoveGroupToFolderMenu.tsx`（新）
  - 单选，调 `moveGroupBetweenFolders`

### Utils

- [ ] `components/conversation-list/utils.ts`
  - `useAppearanceCount`：基于 group 统计（手动文件夹中该 group 出现次数 + 智能分类中该 group 出现次数）
  - `openOrFocusConversation` 不变（点 conversation 行仍走原入口）
  - GroupCard header 点击行为：聚焦组内最后活跃的主会话（推荐），或展开折叠（GroupCard 自有 state）—— 两者都做：单击展开/折叠；双击聚焦最近活跃会话

- [ ] `components/group-list/utils.ts`
  - `deriveGroupTitle` 已有，导出供 Smart/Time section 复用

### Store

- [ ] `stores/conversation-store.ts`
  - 视情况增 `groupsById` 索引 / `getGroupConversations(groupId)` 查询便利方法
  - 不引入新 store（不打破「相关功能集中」原则）

### 不动

- session-store / tabs 仍按 conversationId
- 子会话 ChildConversationRow 在 GroupCard 展开后的 ConversationRowWithChildren 内仍正常渲染（缩进 + 状态图标）
- 共享区面板（SharedAreaPanel）不动
- 微信 / stocks / 设置页（除分类样例文案）不动

## 验证

- `bun run build` 通过
- `bun run lint` 通过
- 启动 app 实测：
  - 三个视图都能正确渲染组卡片
  - 单会话组与多会话组视觉一致（GroupCard header + 展开后 1 或 N 个 conversation 行）
  - 拖 group 到手动文件夹，刷新后仍在
  - 组级菜单：重命名、删除（确认弹窗）、添加/移动到文件夹 全部正常
  - conversation 级菜单：引用、重命名、删除 正常（不再有"添加到文件夹"）
  - 智能分类 section 按 groupIds 渲染
  - 时间 section 按 group.updatedAt 分桶
  - 子会话仍在父会话下缩进显示

## 实施回填

### 实际改动

**与计划差异**
- ViewTabs 三态最终为 `manual | smart | time`，默认 `manual`；GroupList 组件保留但不再被 ConversationList 直接调用（可留作独立测试入口，也可下次清理）
- ManualSection 里 headless-tree 的叶子从 conversation 改成 **group**，FolderTreeItem 内 group 节点直接渲染 `GroupCard`（不再走 ConversationRowWithChildren）
- 后端 `conversation-tree-service.ts` 除了改名 `addConversationToFolder → addGroupToFolder` 等，同时**删除**了 `addConversationToTree / removeConversationFromTree / sortConversationsByUpdatedAt` 三个旧函数：新架构下 root 只装 folderId，group 存在性由 `group-service` 管理，新建/删除 conversation 不再触碰 tree
- tipc/conversations.ts：`create / createFork` 不再调 `treeService.addConversationToTree`；`deleteConversation` 不再调 `removeConversationFromTree`；`reorderTreeByUpdatedAt` 改从 `group-service.listGroups` 拉 updatedAt 供 `sortGroupsByUpdatedAt` 使用
- store: `ConversationFlatNode.nodeType` 改为 `'folder' | 'group'`，节点 `.group?: Group` 替代 `.conversation?`；`buildNodeMap` 换签名 `(groups, treeData)`；`loadConversations` 并行拉 `getByWorkspaceId / getConversationTree / listGroups` 后一次写完，随后同步 `group-store.setState({ groups })` 保证顺序
- 归档区（ArchiveSection）本 step 未动，仍按 conversation 归档展示——与计划一致
- ConversationRow 去掉了 `inFolder / folderId / AddToFolderMenu / MoveToFolderMenu` 相关分支和 AppearanceBadge（AppearanceBadge 上移到 GroupCard 组标题上）；`useAppearanceCount` 语义改为**按 groupId 计数**
- GroupCard header 新增 AppearanceBadge + AddGroupToFolderMenu（无 folderId 时）/ MoveGroupToFolderMenu + 从文件夹移除（有 folderId 时）+ 「删除组」走 `showConfirm` 二次确认（提示会删除 N 个会话）
- 新建两个组级子菜单文件 AddGroupToFolderMenu / MoveGroupToFolderMenu；对应删除旧 AddToFolderMenu / MoveToFolderMenu
- ConversationTreeFile 加 `schemaVersion?: number` 字段（值为 2，跟 migration-p3 一致）
- 一些原计划里的项延后（未做）：
  - GroupCard 双击「聚焦组内最近活跃会话」——保留 GroupCard 现有的单击行为（切换展开 + 选中组），未加双击
  - stores/conversation-store.ts 未新增 `groupsById` 索引 / `getGroupConversations` 便利方法——SmartSection/TimeSection 直接 filter 已经足够
  - RecentVirtualGroup 按 group.updatedAt 分桶（已按计划做），Smart/Time section 中的 RecentVirtualGroup 共用

**改动文件清单**
- 服务/IPC 层：
  - `electron/main/services/conversation-tree-service.ts`（大改：删除三个旧函数 + 重命名三个 folder 操作函数 + 头注释更新 + ConversationTreeFile 加 schemaVersion）
  - `electron/main/services/conversation-service.ts`（`initializeTree` 调用方式简化，不再传对话列表）
  - `electron/main/tipc/conversations.ts`（`reorderTreeByUpdatedAt` 改按 group；`create / createFork / deleteConversation` 去掉 tree 联动；三个 folder RPC 改名 + 入参改 groupId）
- 前端 store：
  - `stores/conversation-store.ts`（ConversationFlatNode 改；buildNodeMap 改；loadConversations 并行拉 groups + 同步 group-store；updateTitle 侧效果不再改 nodeMap；三个 folder action 改名）
- UI：
  - `components/ConversationList.tsx`（删除 GroupList 分支，默认 manual，ManualSection 移入 Tab 之内）
  - `components/conversation-list/ViewTabs.tsx`（三态 manual|smart|time）
  - `components/conversation-list/ManualSection.tsx`（FolderTreeItem 装 group + 渲染 GroupCard；空状态提示引导「通过组卡添加到文件夹」）
  - `components/conversation-list/SmartSection.tsx`（按 groupId 渲染 GroupCard；修 bug）
  - `components/conversation-list/TimeSection.tsx`（按 group.updatedAt 分桶 + GroupCard）
  - `components/conversation-list/RecentVirtualGroup.tsx`（按 group.updatedAt < 5 天 + GroupCard）
  - `components/conversation-list/ConversationRow.tsx`（去掉 inFolder/folderId/AddToFolder/MoveToFolder 逻辑 + AppearanceBadge）
  - `components/conversation-list/utils.ts`（useAppearanceCount 改按 groupId）
  - `components/group-list/GroupCard.tsx`（新增 folderId prop + AppearanceBadge + AddGroupToFolderMenu / MoveGroupToFolderMenu + 从文件夹移除 + 删除组带确认）
- 新增：
  - `components/conversation-list/AddGroupToFolderMenu.tsx`
  - `components/conversation-list/MoveGroupToFolderMenu.tsx`
- 删除：
  - `components/conversation-list/AddToFolderMenu.tsx`
  - `components/conversation-list/MoveToFolderMenu.tsx`

### 给下一步的接力棒

- 关键签名 / 数据结构：
  - `ConversationFlatNode { id; name; isFolder; childrenIds; nodeType: 'folder'|'group'; group?; folder? }`
  - IPC `addGroupToFolder / removeGroupFromFolder / moveGroupBetweenFolders({ workspaceId, groupId, folderId })`
  - Store actions `addGroupToFolder(groupId, folderId)` 等
  - `GroupCard` 接受 `{ group, conversations, folderId? }`：无 folderId 显示"添加到文件夹"，有 folderId 显示"移动到文件夹 + 从文件夹移除"
- 下个 step（Step 4：设置页 + 收尾）该从哪里继续：
  - `app/settings/memory/DigestsPanel.tsx` 已改过一版（Step 2），但 prompt 编辑器还需确认 tipc 用的是 `getGroupDigestPrompt / setGroupDigestPrompt`（Step 2 已改）
  - SmartCategoryPanel 文案微调「按组分类」
  - doc-sync：`.claude/rules/codebase-map.md` 需要更新 memory/tools/components 三段
  - 端到端手测清单按 step4 计划走
- 待办或已知限制：
  - `components/group-list/GroupList.tsx` 组件已不被引用，看 step4 时决定删或留作独立入口
  - 从文件夹删除的组：如果只在 __root__ 之外没有任何 folder 引用，就只能在 smart/time 视图里看到——用户不好察觉；设计已如此，Step 4 若发现体验差再补
  - `stores/conversation-store.ts` 与 `group-store.ts` 之间加载顺序靠 `loadConversations` 内部 `setState` 保证；如果绕开这个入口独立拉 group-store 可能顺序错开——目前无此路径
