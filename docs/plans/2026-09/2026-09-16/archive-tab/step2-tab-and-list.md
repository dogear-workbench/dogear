---
step: 2
title: 归档 tab 与左侧列表
status: done
---

## 目标
归档以哨兵 tab 打开，左侧渲染话题列表（主会话行 + 子会话徽标 + 搜索 + 恢复/删除菜单），右侧暂为空态占位。

## 依赖上下文（接力棒输入）
- 前置 step 产出：Step 1 的 digest IPC 已就绪（本步暂不消费，Step 3 才用）。
- 当前关键文件状态：
  - `stores/session-store.ts`：哨兵模式参考 `DATA_CENTER_TAB_ID` / `dataCenterTabOpen` / `openDataCenterTab` / `closeDataCenterTab`；归档 tab 不写 localStorage。
  - `components/WorkspaceTabBar.tsx`：哨兵 tab 渲染在右组（笔记/数据中心/文章），归档 tab 加在同组，含 Archive 图标 +「归档」+ 关闭按钮；`showSentinelGroup` 条件需纳入归档。
  - `app/page.tsx`：挂载模式参考 DATA_CENTER（absolute inset-0 + display 切换）。
  - `components/conversation-list/ArchiveSection.tsx`：现Dialog 整体删除，保留底部按钮改为 `openArchiveTab()`；徽标数字继续用 listArchivedTopics 计数。
  - 列表数据：`client.listArchivedTopics({ workspaceId })` + `lib/conversation-sort.ts` 的 `buildConversationTree` 构树；主会话行子会话数 = node.children 总数（递归）。
  - 恢复/删除：`useGroupStore` 的 `restoreTopic` / `deleteTopic`（GroupCard 现有 archived 模式逻辑可参考，但本页自建轻量列表，不复用 GroupCard）。
  - 刷新时机：跟随 `useGroupStore((s) => s.groups)` 变化重拉列表（与原 ArchiveSection 一致）。
- 关键决策回顾：左侧与现有会话列表同构但自建轻量组件（不复用 GroupCard/ConversationRow，它们绑定活跃态逻辑）；子会话不出行；搜索只过滤话题标题；恢复成功 toast + 列表刷新，不自动跳转。

## 计划改动
- [ ] `stores/session-store.ts`：`ARCHIVE_TAB_ID = '__archive__'`、入 `SENTINEL_TAB_IDS`、`archiveTabOpen` 状态、`openArchiveTab` / `closeArchiveTab`（仿 dataCenter，无 localStorage）
- [ ] `components/WorkspaceTabBar.tsx`：右组渲染归档 tab（archiveTabOpen 时显示，点击 switchTab，X 关闭）
- [ ] `app/page.tsx`：挂载 ArchivePage（display 切换）
- [ ] 新建 `components/archive/ArchivePage.tsx`：左列表 + 右内容区骨架；右侧本步显示「选择左侧会话查看」空态
- [ ] 新建 `components/archive/` 下左侧列表组件（话题卡展开 + 主会话行 + 子会话数量徽标 + 搜索框 + 话题右键菜单恢复/永久删除 + 初始默认选中第一个话题第一个主会话 + 空态「暂无归档话题」）
- [ ] `components/conversation-list/ArchiveSection.tsx`：删 Dialog，按钮改开 tab

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 恢复成功加 toast.success（设计文档「交互细节」明确要求，GroupCard 原无）
  - 首拉 loading spinner 防「暂无归档话题」闪烁（计划未提及的空态细节）
  - 归档 tab 无「弹出独立窗口」按钮（计划只要求图标+标题+关闭）
- 改动文件清单：
  - `stores/session-store.ts:20` ARCHIVE_TAB_ID 入 SENTINEL_TAB_IDS；archiveTabOpen 状态 + openArchiveTab/closeArchiveTab（不落 localStorage，close 用 pickFallbackTab 回退）
  - `components/WorkspaceTabBar.tsx:253` 右组渲染归档 tab（Archive 图标+归档+hover 关闭）；showSentinelGroup 纳入 archiveTabOpen
  - `app/page.tsx:358` 仿 DATA_CENTER 挂载 ArchivePage（absolute inset-0 + display 切换）
  - 新建 `components/archive/`：ArchivePage.tsx（~145 行，数据拉取/默认选中/选中清理/搜索/空态）、ArchiveTopicList.tsx（~170 行，话题卡/主会话行/子会话徽标/右键恢复·删除）、types.ts（ArchiveSelection/ArchivedTopicData）、utils.ts（countTreeConversations/countDescendants）
  - `components/conversation-list/ArchiveSection.tsx`：删 Dialog/GroupCard/ScrollArea，按钮改 openArchiveTab()，计数保留

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `ArchiveSelection { topicId: string; conversationId: string }`（topicId 即 groupId，可直接传 getArchivedTopicDigest）；`ArchivePageProps.onSelectionChange?: (selection | null) => void`
  - 右侧挂载点：ArchivePage 右 section 的占位 div（「选择左侧会话查看」）直接替换为 digest 视图；主会话标题/子会话数从 topics 按 selection 查，徽标数复用 countDescendants
  - 选中话题/会话消失时 ArchivePage 自动置 selection=null（右侧需响应回空态）
- 下个 step 该从哪里继续：Step 3 在右侧挂载点接 digest 视图组件；拉取/缓存建议在视图组件内做
- 待办或已知限制：digest 视图、同话题缓存、失败重试均 Step 3 范围；切工作区靠重拉+选中清理兑底已闭环
