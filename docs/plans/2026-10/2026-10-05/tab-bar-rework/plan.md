# 会话 Tab 栏重设计实施计划

**目标**：tab 栏通过「未读置顶 + LRU 排序 + 三态视觉 + 满员回收」解决多会话辨识与找回；左侧列表同源渲染未读；子会话已交付后输入区软提示回主会话。

**架构思路**：unread 作为 conversation 数据层标记（sessionComplete 写入、全局焦点清除），tab 与左侧列表是同一状态的两个视图；tab 排序与回收全部收敛在 session-store。设计全文见 [../tab-bar-rework-design.md](../tab-bar-rework-design.md)。

**涉及模块**：`electron/main/tipc/agent.ts`（sessionComplete 事件核实）、`services/conversation-service.ts`、`services/focused-conversation-service.ts`、`stores/conversation-store.ts`、`stores/session-store.ts`、`components/WorkspaceTabBar.tsx`、`components/conversation-list/ConversationRow.tsx`、`components/agent-chat/ChatInputArea.tsx`（或 AgentChat）

## 步骤索引

- [x] [Step 1: unread 数据链路](./step1-unread-data.md) — conversation 增加 unread 标记，sessionComplete 驱动写入、全局焦点驱动清除，落盘 conversations.json
- [x] [Step 2: tabs LRU 排序 + 满员回收](./step2-tab-sorting.md) — session-store 焦点驱动重排（未读 > 最近活跃）与 openTab 满员回收闲置会话
- [x] [Step 3: tab 栏与列表行未读渲染](./step3-unread-ui.md) — WorkspaceTabBar 三态视觉 + 绿点 + 主子标识 + 同树相邻；ConversationRow 未读绿点
- [x] [Step 4: 子会话已交付提示条](./step4-subsession-hint.md) — 子会话交付/停止后输入区顶部软提示 + 回主会话跳转
- [x] [Step 5: 溢出收纳与哨兵图标化](./step5-overflow-collapse.md) — 取消横向滚动：哨兵 tab 图标化、会话 tab 弹性宽度 + 「…」溢出菜单，可见 tab 标题永远可读

依赖链：Step 1 → Step 2 → Step 3 → Step 5；Step 4 独立（只依赖子会话交付状态判定）。

## 完成总结（2026-10-06）

五个 step 全部实施完毕并逐 step 验收提交（fa433d98 → e9b89c6e）。

**数据层**：conversation 记录新增 unread 标记，complete 广播补 conversationId，conversation-store 订阅完成/焦点事件驱动置位与清除，setUnread 服务层防翻转落盘（仅真实翻转写盘一次）。

**排序与回收**：session-store 持有 sortTabs（未读置前 → lastActiveAt 降序，稳定排序），焦点变化与 unread 翻转两个触发点；openTab 满员时自动回收最久未活跃的闲置 tab（四条保护：运行中/等待确认/未读/独立窗口弹出中）；回退链改按 lastActiveAt 语义。

**渲染层**：tab 栏三态视觉（未读绿点加粗 / 闲置 24h 淡化 / 运行 StatusPulse），同派遣树主子相邻（DFS 聚组 + ↳ 标识，数据源 contractMetadata.parentSessionId）；左侧列表行同源绿点；子会话已交付后输入区软提示条 + 回主会话三级跳转链路；哨兵 tab 图标化 + 弹性可见数 + 「…」溢出菜单（溢出区未读绿点），取消横向滚动。

**关键差异沉淀**（详见各 step 回填）：主子关系以 contractMetadata.parentSessionId 派遣树为准（parentConversationId 是 fork 语义）；子会话交付信号源用 bridge 内存快照 childSnapshotsById（重启后不可恢复，宁缺勿滥不显示）；子会话 tab 聚组优先于单 tab 置顶（溢出菜单点击子会话跟随父位置）。

**遗留**：手测未做（全部子会话无 UI 环境），建议走查路径在 step3/step5 回填段；独立窗口内「回主会话」按钮隐藏（跨窗口跳转需主进程基建，后续单独立项）；未读组内序用 lastActiveAt 而非置位时间（无 unreadAt 字段，产品要求严格置位序时需数据层补字段）。

## 全局决策

- **命名**：conversation 记录加 `unread?: boolean`（缺省 falsy 兼容旧数据）；`SessionTab` 加 `lastActiveAt: number`（epoch ms）。
- **unread 落盘**：只在状态翻转时写 conversations.json（禁止高频写盘）；写入点在前端收到完成事件处，复用 conversation-service 现有 CRUD，写后走 conversationListChanged 事件回环刷新（禁止手动 loadConversations）。
- **焦点语义**：统一以全局焦点会话（focusedConversationChanged）作为「已看/活跃」信号——清 unread、更新 lastActiveAt 都挂在这里，不散落在各 UI 组件。
- **三条回收红线**：运行中（runningConversationIds）、等待确认（pendingActionConversationIds）、未读（unread）的 tab 永不被满员回收。
- **排序稳定性**：重排仅在「焦点变化 / unread 翻转」时触发；closeTab 等操作保持剩余 tab 相对顺序。
- **视觉**：未读 = 绿点（lucide Circle 填充小圆或纯 CSS 圆点）+ 标题 font-medium；闲置超 24h opacity-60 淡化（阈值与参数视觉走查可调）；运行中维持现有 StatusPulse 不动。
- **不做**：未读数字、FLIP 动画、定时自动回收、逐条消息已读、纵向 tab、去标题化（均 YAGNI 或已排除，见设计文档排除项）。
- **溢出收纳**：可见数由容器宽度弹性计算（min-w 收缩至 max-w-[200px]）；溢出菜单项复用 tabs 数组序与三态状态源；「…」按钮在溢出区有未读时显示绿点；任何宽度场景不出横向滚动条。
- 代码风格遵循项目规范：不写注释（WHY 非显而易见时最多一行）。
