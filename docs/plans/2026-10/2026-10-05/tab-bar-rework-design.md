# 会话 Tab 栏重设计：状态分层 + 未读置顶 + 满员回收 + 主子边界

**背景**：tab 开多后臃肿且分不清谁是谁；会话跑完进入闲置后淹没在僵尸 tab 里找不到；用户在子会话看运行过程后顺手误发下一步消息（应回主会话）。曾考虑去掉 tab，但 tab 承担「活跃会话可见性 + 显式释放入口」且跨工作区保留，不可去；也曾考虑主子会话合并 tab + 下拉切换，因多一步操作且解决不了误发问题而否决。

**目标**：tab 收缩为「活跃工作集」（与左侧列表形成 全集 vs 工作集 互补），通过状态分层与自动排序解决辨识与找回；僵尸会话满员时自动回收；主子会话边界在发送前软提示。

**架构**（核心做法）：

1. **tab 三态视觉**：运行中（现有 StatusPulse，不动）/ 完成待看（未读：绿点 + 标题加粗 + 置顶）/ 闲置（正常态；lastActiveAt 超过 24h 后 opacity 淡化）。
2. **未读数据流**（单一数据源，两视图渲染）：
   - 写入：后端 sessionComplete（一轮跑完，含子会话交付）→ 标记该 conversation `unread`；**完成瞬间该会话正是当前全局焦点则不标**。
   - 清除：会话成为全局焦点即清（focusedConversationChanged），一个条件覆盖 tab 切换 / 列表点击 / 独立窗口聚焦三条路径。
   - 「等待确认」（pendingAction）不叠加未读，保持单一语义。
3. **LRU 自动排序**：排序键 = 未读 > 其余按最近活跃时间降序。「活跃」= 会话成为全局焦点。运行中不特殊置顶（pulse 已显眼，跑完自然变未读置顶）。独立窗口中的会话不参与（已被过滤）。排序为全局排序（tab 跨工作区保留）。
4. **满员回收（乙策略）**：openTab 达到 MAX_TABS=10 时，回收「最久未活跃且非运行中、非等待确认、非未读」的 tab（closeQueryBasedSession release 语义），toast 告知「已释放闲置会话 X」；无可回收者维持现有上限 toast。三类红线状态永不自动回收。
5. **主子边界**：
   - 子会话 tab 带层级标识（`↳` 前缀或角标），同派遣树主子相邻排列。
   - 子会话**已交付/停止**后输入区顶部显示软提示条：「该子会话任务已交付，新任务建议回主会话 [回主会话]」；纯提示不拦发送（追问运行细节合法）。运行中不显示。
   - 左侧列表行同样渲染未读绿点 + 加粗——覆盖不占 tab 的会话（agent 派的子会话、飞书 bot、定时任务）。

6. **溢出收纳与宽度弹性**：取消 tab 栏横向滚动（滚动区里的 tab 反正看不见，还挤窄可见 tab）——哨兵 tab（笔记/数据中心/归档/飞书/网页AI）改纯图标 + tooltip 省宽，文章 tab 保留标题；会话 tab 按容器实际宽度显示放得下的，超出自动收进最右「…」溢出菜单（菜单内 LRU 顺序，带绿点/运行态/关闭，点击弹回栏内）；tab 宽度随数量弹性（少则宽，min 收缩、max 200px），hover tooltip 完整标题；「…」按钮在溢出区存在未读 tab 时显示绿点。与 LRU 排序天然配合：可视区永远是该看的，被收起的就是最久没动的。伴随面板开合导致的容器宽度变化自动响应。

**排除的选项及原因**：
- 无 tab 化：丢失跨工作区工作集、紧凑视图、显式释放入口；「何时算关闭」的自动语义有误伤。
- 主子合并 tab + 下拉：多一步操作；子会话短生命周期低频查看，投入产出低；救不了「正在子会话输入框打字」的误发。
- 定时自动回收（甲策略）：闲置 N 小时无差别释放会误伤想留的会话；满员回收按需触发零骚扰。
- 纵向 tab（Arc 式侧边栏 tab）：与左侧列表纵向导航职责冲突——左侧列表已能看清哪些会话开着（用户确认），tab 的独特价值是横向工作集一击直达与跨工作区。
- 去标题化：会话无图标类语义载体，标题是 tab 间唯一区分信息，去掉后辨识度更差。

**模块边界**：
- 后端事件：sessionComplete 广播需可定位 conversationId（实施时核实现有事件负载）。
- conversation 数据层：`unread` 标记落 conversations.json（conversation-service CRUD 扩展）。
- `stores/session-store.ts`：tabs 排序（焦点驱动重排）、满员回收逻辑、lastActiveAt。
- `stores/conversation-store.ts`：unread 状态接收（sessionComplete 事件订阅、focusedConversationChanged 清除联动）。
- `components/WorkspaceTabBar.tsx`：三态渲染、绿点、主子标识与同树相邻、溢出收纳（容器测宽 + 弹性宽度 + 哨兵图标化）。
- `components/conversation-list/ConversationRow.tsx`：未读绿点 + 加粗。
- `components/agent-chat/ChatInputArea.tsx`（或 AgentChat）：子会话已交付提示条 + 回主会话跳转（onOpenParent 既有机制）。
- `services/focused-conversation-service.ts`：焦点变化作为统一清除/活跃信号源。

**数据流**：
1. sessionComplete → 前端订阅 → 非焦点会话标 unread（conversation-store + 落盘）→ session-store tabs 重排（未读置顶）→ tab 绿点加粗 / 列表行绿点加粗。
2. focusedConversationChanged → 清该会话 unread → tabs 重排（回 LRU 位）。
3. 会话成为焦点 → 更新 lastActiveAt（排序键 + 24h 淡化判定）。
4. openTab 满员 → 挑最久未活跃可回收 tab → closeQueryBasedSession → closeTab → toast。

**错误处理 / 边界情况**：
- 完成瞬间正是焦点：不标未读。
- 满员且 10 个全为红线状态：维持现有「最多只能同时打开 10 个会话」toast。
- 独立窗口会话：不占 tab、不参与排序与回收（现状保持）。
- 未读会话不可被满员回收（红线）。
- 排序跳动对点击的影响：接受（IM 心智模型），不做 FLIP 动画（第一版，YAGNI）。

**未决问题**：
- 子会话「已交付/停止」状态的判定来源（交付事件 vs sessionClosed vs runningSet 移除），实施时核实后端事件后定。
- 淡化阈值 24h 与视觉参数（opacity 数值）实施时视觉走查定。
- unread 落盘粒度（写 conversations.json 的时机，避免高频写盘）：倾向只在状态翻转时写。
