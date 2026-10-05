# 会话 Tab 栏重设计实施计划

**目标**：tab 栏通过「未读置顶 + LRU 排序 + 三态视觉 + 满员回收」解决多会话辨识与找回；左侧列表同源渲染未读；子会话已交付后输入区软提示回主会话。

**架构思路**：unread 作为 conversation 数据层标记（sessionComplete 写入、全局焦点清除），tab 与左侧列表是同一状态的两个视图；tab 排序与回收全部收敛在 session-store。设计全文见 [../tab-bar-rework-design.md](../tab-bar-rework-design.md)。

**涉及模块**：`electron/main/tipc/agent.ts`（sessionComplete 事件核实）、`services/conversation-service.ts`、`services/focused-conversation-service.ts`、`stores/conversation-store.ts`、`stores/session-store.ts`、`components/WorkspaceTabBar.tsx`、`components/conversation-list/ConversationRow.tsx`、`components/agent-chat/ChatInputArea.tsx`（或 AgentChat）

## 步骤索引

- [x] [Step 1: unread 数据链路](./step1-unread-data.md) — conversation 增加 unread 标记，sessionComplete 驱动写入、全局焦点驱动清除，落盘 conversations.json
- [x] [Step 2: tabs LRU 排序 + 满员回收](./step2-tab-sorting.md) — session-store 焦点驱动重排（未读 > 最近活跃）与 openTab 满员回收闲置会话
- [ ] [Step 3: tab 栏与列表行未读渲染](./step3-unread-ui.md) — WorkspaceTabBar 三态视觉 + 绿点 + 主子标识 + 同树相邻；ConversationRow 未读绿点
- [ ] [Step 4: 子会话已交付提示条](./step4-subsession-hint.md) — 子会话交付/停止后输入区顶部软提示 + 回主会话跳转
- [ ] [Step 5: 溢出收纳与哨兵图标化](./step5-overflow-collapse.md) — 取消横向滚动：哨兵 tab 图标化、会话 tab 弹性宽度 + 「…」溢出菜单，可见 tab 标题永远可读

依赖链：Step 1 → Step 2 → Step 3 → Step 5；Step 4 独立（只依赖子会话交付状态判定）。

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
