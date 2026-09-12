# GUI 回归第三轮反馈修复 设计

**日期**：2026-09-12
**背景**：会话渲染优化任务（0ktv8w9q）7 步实施完成进入 GUI 人工回归，用户反馈渲染与交互问题 + 新增需求。本文档为第三轮反馈的设计定稿，配套实施计划见 [plan.md](./plan.md)。

**目标**：统一「agent↔agent 通讯是消息不是工具操作」的渲染心智模型；修正绿色存活标识语义；设置改为保存即分层生效；执行会话提示词去冗余；新增顶部消息中心。

## 问题清单与方案

### 1. ReportTaskResult 申报渲染（摘出工具壳）

**现状**：走 ToolBlock 工具卡壳 + TaskResultRenderer（components/agent-chat/tool-renderers/TaskResultRenderer.tsx），是全 DOGEAR 卡中唯一默认展开的工具卡。

**方案**：`dogear__ReportTaskResult` 的 tool_use 块不再走工具卡路径，在 ContentBlockItem 的 tool_use 分支拦截（同注入消息的优先分支思路），渲染为消息流样式的**申报消息**：
- 徽章「任务申报」+ 任务状态徽章（review 待审核等，从 toolOutput 提取）+「打开任务」链接（沿用 requestTaskFocus 链路）
- result 摘要全文以 markdown 正文渲染
- 申报中的「待用户确认事项」由 agent 按现有引导（task-tools.ts:161）另行调用 `dogear__TrackUserActions`，勾选卡同样摘出工具壳，渲染为消息式勾选卡紧跟申报消息出现

**排除的选项**：渲染层解析 result 文本「遗留」段落自动生成勾选行——依赖文本格式、跨批次（重申报 toolUseId 变化）防重复杂，不采用。

### 2. agent↔agent 通讯一律一行收起

**现状**：SendMessage 走 DeliveryCardRenderer 工具卡（交付=绿卡、普通=键值对壳）；子会话注入消息走 InjectedMessageCard 默认收起一行。

**方案**：
- SendMessage 摘出工具壳，渲染为「→ 发给 @目标会话名」**一行收起卡**（delivery=true 加绿色交付徽章）
- 子会话注入消息保持「← @来源会话名」一行收起
- 两方向统一组件（如 AgentCommCard），类型色沿用 INJECTION_TAG_STYLES（交付绿/回复蓝/终态红橙/续跑蓝）
- **展开态上下各一个收起触发点**（长内容底部直接收起，不滚回顶部）
- 只有主会话给用户的回复正文才展开渲染为消息；agent↔agent 通讯永不自动展开

### 3. 等待图标与插话提示

- AwaitingDeliveryIndicator（components/agent-chat/AwaitingDeliveryIndicator.tsx）双层动效（animate-ping + animate-pulse）改为 Loader2 `animate-spin` 旋转
- 删除点击中断：AgentChat.tsx handleAbortWait（:152-168）→ abortWaitForDeliveries tipc → bridge.abortWaitsForParent 整条链，异步模式下不再需要挂起语义。若链路无其他消费方则连 IPC 一并清理

### 4. 绿色存活标识语义修正

**现状**：alive = session 在内存 &&（isRunning || 被 hold）（pi-session-manager.ts:265-269 getAliveConversationIds）。

**方案**：绿条语义改为「**会话被实例化、活着**」——判定改为只要 session 在内存即 alive。运行状态由橙色运行点（runningConversationIds）独立表达。被 _destroySession 回收才灭。

**实施要点**：逐点检查 alive 集合消费方（交付 target_inactive 判定、resume 判断等），语义从「运行/被等待」变为「存活」后确认不破坏：内存中空闲会话收到注入消息会被唤醒处理，行为应更准确而非更差。

### 5. 执行会话提示词精简

**现状**：任务执行会话与主会话同一套 systemPrompt 注入（pi-session.ts:449-471 组装），且 buildGroupContextPrompt 调用未传 selfConversationId（:411），执行会话自己出现在【最近未提炼会话】并触发「开局调 ReadGroupBackground」指引——纯开销。

**方案**：对任务执行会话（task-queue 创建、role:'main' 的无人值守会话，需加显式识别标记）注入裁剪：
- **砍**：组上下文的「话题状态 + ReadGroupBackground 开局指引」子段（保留组头、协作规范、Profile 索引——staged 分步实施派子会话必需）
- **砍**：笔记存卡纪律（NOTES_DISCIPLINE_APPEND，500 字符，聊方案动线对被执行对象无意义）
- **保留**：记忆系统规范（218 字符）、core-profile、两级 agent.md、skills 索引
- 顺手修：buildGroupContextPrompt 传 selfConversationId，消除「自己出现在未提炼列表」

### 6. 设置保存并退出 + 分层生效

**现状**：「保存并重启会话」= updateSettings(restartSessions:true) → 每窗口 restartActiveSessions → closeAll **无差别杀所有活跃 session（含后台任务/子会话）** → 仅重建当前打开会话。

**方案**：
- 按钮改「**保存并退出**」：保存 + 关闭设置页，零重启
- 生效分层：
  - 纯 UI 类（fontSize/theme/sound 等）：现有广播热更新（setup-settings-sync.ts），保持
  - 按次读取类（browserProxyServer 等）：天然即时，保持
  - **agent 启动快照类**（模型/effort/权限/超时/压缩阈值/basicToolPermissions）：updateSettings 计算变更域（diff 新旧），命中快照域 → 给受影响 PiSession **标脏**；PiSession 在下一轮 sendMessage 前检测脏标记 → 重建会话（复用 failover 重建机制：同 harnessSessionId 重 open，历史不丢，model-failover.ts:104-107 已验证该路径）
- 已有热 setter 先例（setPermissionMode / updateWorkspacePaths）优先用热更新，其余走脏标记重建
- closeAll 不再被设置保存触发

### 7. 顶部消息中心（新功能）

**形态**：顶栏铃铛图标 + 未读数徽章 → 下拉面板（邮箱式）。

**归属规则（拍板）**：子会话的动作（交付/终止/中断恢复）归属到**父会话**名下，跳转跳到父会话；用户直接看到的通知只有两类——自己管的主会话事件 + 系统级事件（任务待审核/中断/执行失败）。

**数据流**：主进程新增通知存储 service（JSON 持久化，条目含类型/标题/摘要/时间/已读/归属 sessionId 或 system/跳转目标）→ tipc 路由（list / markRead / markAllRead + notificationsChanged 广播）→ 渲染层 store + 铃铛下拉。

**写入点**：复用 session-notification-service 现有触发（任务中断 task-queue.ts:307/358、执行失败 :322）+ **新增任务进入 review 通知**（reportTaskResult → transition review 时，补上工具描述宣称却缺失的行为）+ 子会话交付/终态事件（parentId 归属）。系统级 toast 通知保留不动，中心是聚合层。

### 8. 插话提示去掉

插话（steer）发送后的成功提示 toast 删除——消息出现在流里本身就是确认。

## 模块边界

| 模块 | 文件 |
|---|---|
| 渲染拦截与消息式组件 | components/agent-chat/ContentBlockItem.tsx、ToolBlock.tsx、tool-renderers/*、MessageItem.tsx |
| 勾选复用 hook | 从 TrackUserActionsRenderer.tsx 抽 useUserActionChecklist |
| 等待图标/插话 | AwaitingDeliveryIndicator.tsx、AgentChat.tsx、ChatInputArea.tsx |
| alive 语义 | electron/main/agents/pi-session/pi-session-manager.ts |
| 提示词组装 | electron/main/agents/pi-session/pi-session.ts、session-append-templates.ts、group-context-builder.ts |
| 设置 | app/settings/page.tsx、electron/main/tipc/settings.ts、pi-session.ts（脏标记）、setup-settings-sync.ts |
| 消息中心 | 新增 notification service + tipc 路由 + 顶栏组件 + store |

## 错误处理 / 边界

- 勾选卡跨批次防重：沿用 localStorage（toolUseId 维度）+ 已勾 disabled；重申报是新 toolUseId 属新批次，语义上允许
- 设置 diff 域划分要完整枚举设置项归类，漏分会导致该热不热（用户感知延迟）或该缓不缓（意外重建）
- 脏会话正在跑时：不打断当前轮，跑完下轮 sendMessage 前重建
- 消息中心通知量控制：同源事件聚合/上限条数，避免刷屏

## 未决问题（实施时定）

1. 等待图标中断链清理深度（仅 UI 入口 vs 连 IPC/bridge 一并删）——grep 消费方后定
2. 执行会话识别标记的实现方式（conversation 元数据 vs attach 参数 flag）
3. 设置快照域的精确清单与 diff 键映射
4. 消息中心铃铛在顶栏的具体挂载位置（布局现状定）
5. alive 语义变更后 target_inactive 等消费方的逐点验证结论

> 注：文中行号为 2026-09-12 调研快照，实施时以实际代码为准。
