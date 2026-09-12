---
step: 7
title: 顶部消息中心
status: done
---

## 目标
新增顶栏铃铛消息中心（邮箱式）：聚合系统提示与主会话相关事件，未读徽章、点击跳转、点即已读；补上任务进入 review 的通知；子会话事件归属父会话。

## 依赖上下文（接力棒输入）
- 设计依据：[design.md](../design.md) 第 7 节
- 归属规则（拍板）：子会话动作（交付/终止/中断恢复）→ parentId 归属父会话，跳转跳父会话；系统级（任务 review/中断/执行失败）→ system，跳任务面板；系统 toast 保留不动
- 现有触发点：notifyTask（task-queue.ts:54-64，走 session-notification-service）现仅任务中断（:307/:358）与执行失败（:322）；review 进入无通知（task-store.ts:265-277 transition 处补）
- 子会话事件源：delegation-bridge 终态结算/交付链路（releaseParentHold :153-160/:278 附近）
- 跳转先例：任务 focus 用 requestTaskFocus（TaskResultRenderer/ToolBlock 的打开任务链路）；会话跳转用 openOrFocusConversation（ToolBlock.tsx:351-367）
- 存储先例：JSON 文件持久化（.dogear/ 目录，参考 background-store/task-service 的模式）

## 计划改动
- [x] 主进程 notification service：JSON 存储（条目：id/类型/标题/摘要/时间/read/owner{kind:'system'|'conversation', sessionId?}/跳转目标），上限条数与同源聚合，广播 notificationsChanged
- [x] 写入点接入：notifyTask 三个触发 + review 进入（task-store transition）+ 子会话交付/终态（bridge，归属父会话）
- [x] tipc 路由：listNotifications / markRead / markAllRead + 变更广播
- [x] 渲染层：顶栏铃铛 + 未读徽章 + 下拉面板（类型图标/标题/时间/归属名，未读高亮，全部已读）；点击条目 → review 跳任务面板 focus、会话事件跳 openOrFocusConversation（父会话），跳转即已读
- [x] 重启恢复：未读状态持久化，窗口加载拉初值
- [x] 验证：申报进入 review 铃铛亮 + 跳转定位；子会话交付出现在中心且归属父会话；toast 行为不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. review 进入通知未挂 task-store.transition（零 Electron 依赖层保持纯净），挂 task-service.reportTaskResult（review 唯一入口，广播聚合层，返回 Task 含全部上下文）；completeTask（running→review）无生产调用方不挂
  2. notifyTaskInterrupted 原复用 notifyTask，现拆开为独立函数（dedupeKey 语义区分 interrupted/failed），session-notification-service 调用参数不变（toast 行为零变化）
  3. 铃铛挂主窗口 header 右侧按钮组最前（settings 前），独立会话窗口/伴随工作台不挂（广播到达无订阅无副作用）
  4. 渲染层点击条目跳转前先 markRead（乐观更新，失败回拉），跳转逻辑复用 focusTask 监听同款链路
  5. renderer-handlers 新事件名 notificationsChanged（载荷 {unreadCount}）；tipc 路由名 markNotificationRead/markAllNotificationsRead（避免与其他路由潜在重名，语义同 markRead/markAllRead）
- 改动文件清单：
  - 新增 electron/main/services/notification-center-service.ts（service + 单测 notification-center-service.test.ts 6 用例）
  - 新增 electron/main/tipc/notifications.ts、types/notification.ts（渲染层镜像）、stores/notification-store.ts、components/NotificationCenter.tsx
  - 修改 electron/main/services/task-service.ts（reportTaskResult → notifyTaskReview）、task-queue.ts（notifyTask/notifyTaskInterrupted 双写）、electron/main/agents/tools/delegation-tools.ts（sub→父交付通知）、electron/main/agents/delegation-bridge.ts（notifyTerminalToParent 终态通知）、electron/main/tipc/index.ts + renderer-handlers.ts、app/page.tsx（header 挂铃铛）、docs/codebase-map.md

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - service：getNotificationCenterService().add(AddNotificationInput) / list() / markRead(id) / markAllRead()；条目 NotificationCenterEntry{id,type:'task'|'conversation',dedupeKey,title,summary?,createdAt,read,count,owner:{kind:'system'}|{kind:'conversation',conversationId},taskId?,workspaceId?,ownerLabel?}
  - dedupeKey 约定：task:{taskId}:{review|interrupted|failed}、conversation:{childId}:{delivery|terminal}；同源未读聚合（count+1+刷新），已读后同源再来是新条目
  - 存储：getConfigDir()/notifications.json（{version:1, entries}，上限 100，超限先丢已读旧再丢最旧未读）；service 广播走动态 import（tipc/main 静态链在 bun test 下炸 electron named export）
  - 渲染层：useNotificationStore（loadNotifications/markRead/markAllRead/subscribeNotificationsChanged(isPanelOpen)）；跳转即已读（markRead 乐观 + openEntry）
- 下个 step 该从哪里继续：本 step 无后续 step 依赖；验收前可关注遗留第 1/2 条
- 待办或已知限制：
  1. 中断任务的「重启恢复」通知（recoverAndStartTaskQueue）在窗口加载竞态窗口内可能广播早于渲染层订阅——初值拉取（loadNotifications）已兑底，仅极端时序下徽章数字短暂不准，打开面板即修正
  2. notifyTerminalToParent 的 !sessionId 提前 return 分支不写通知中心（子会话尚未 init 即终态的罕见路径）
  3. count 聚合上限即 MAX_ENTRIES 生命周期，条目被裁剪后计数归零重来
