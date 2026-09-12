---
step: 3
title: 通知中心收敛与治理
status: done
---

## 目标
消息中心只留「需要用户行动/注意」的系统级通知；补删除/清空/自动过期能力。

## 依赖上下文（接力棒输入）
- 关键文件状态：
  - `electron/main/services/notification-center-service.ts`：add/markRead/markAllRead/list，persist 带 MAX_ENTRIES=100 淘汰，无删除/过期
  - 噪音源一：`electron/main/agents/tools/delegation-tools.ts:107` 附近——SendMessage 里 `role==='sub' && delivery` 分支的 `getNotificationCenterService().add`（子会话交付通知；`bridge.markChildDelivered` 保留）
  - 噪音源二：`electron/main/agents/delegation-bridge.ts:389` 附近——notifyTerminalToParent 里的 add（子会话终态通知；注入父会话的 notice 逻辑保留）
  - 保留项：task-queue.ts / task-service.ts 的任务中断/失败/review 通知不动
  - 前端：`components/NotificationCenter.tsx`（Popover 列表 + 全部已读）、`stores/notification-store.ts`（loadNotifications/markRead/markAllRead + subscribeNotificationsChanged）、tipc 路由按现有 notification 相关 route 文件同址扩展
- 关键决策回顾：实测通知列表全是「子会话「xxx」运行失败/已取消」——归属虽对但粒度是 agent 内部协作流，父会话会自动处理，用户不需要知道；子会话交付/终态两类全移除是拍板结论

## 计划改动
- [x] `delegation-tools.ts`：删 SendMessage 内的交付通知 add 调用（含上面 resolve parentConv 的辅助代码若仅为此服务）
- [x] `delegation-bridge.ts` notifyTerminalToParent：删 add 调用（保留注入与 statusLabel 等其余逻辑）
- [x] `notification-center-service.ts`：加 `remove(id)`、`clearAll()`、`pruneExpired(maxAgeMs = 24h)`（只清已读且超龄的）；主进程启动时机调用 pruneExpired（找 service 初始化/首消费点，懒加载 instance 首次创建时跑一次亦可）
- [x] tipc 路由：加 `notificationRemove({ id })`、`notificationClearAll()`（与现有 notification list/markRead 路由同文件同风格，广播 notificationsChanged）
- [x] `stores/notification-store.ts`：加 remove/clearAll，本地过滤后更新
- [x] `NotificationCenter.tsx`：顶部「全部已读」旁加「清空」按钮（confirm-store showConfirm 确认后执行）；条目 hover 显示删除小按钮（X 图标，阻止冒泡避免触发跳转）

## 实施回填（做完后填）

### 实际改动
- delegation-tools.ts：删 SendMessage 交付通知 add + parentConv resolve 辅助代码 + getNotificationCenterService import（bridge.markChildDelivered 保留）
- delegation-bridge.ts：notifyTerminalToParent 删通知 add + parentConv resolve；局部变量 statusLabel 删 add 后不再被使用一并删（terminalStatusLabel import 在 266/401 行仍有使用，保留）；getNotificationCenterService import 删除
- notification-center-service.ts：新增 remove(id) / clearAll() / pruneExpired(maxAgeMs = 24h 返回删除数)；pruneExpired 过滤条件为「保留未读或未超龄」（即只删已读且超龄）
- main-app.ts：whenReady 启动任务区（cleanupLegacyStateFile 之后）动态 import 调 pruneExpired()
- tipc/notifications.ts：加 notificationRemove / notificationClearAll 路由（广播沿用 service.persist 内的 notificationsChanged，与现有路由同风格）
- stores/notification-store.ts：加 remove / clearAll（本地乐观更新 + IPC 失败回滚重拉）
- NotificationCenter.tsx：顶部加「清空」按钮（showConfirm 确认）；条目外层 button 改为 div[role=button]（避免嵌套交互元素）+ 键盘支持；条目尾部加 hover 显示的 X 删除按钮（stopPropagation）
- notification-center-service.test.ts：补 remove / clearAll / pruneExpired 三个测试（共 9 个全过）

#### 与计划差异
- pruneExpired 初版过滤条件写反（会删「未读且超龄」），被新增测试抓出后修正为「只删已读且超龄」
- NotificationCenter.tsx 条目外层元素由 button 改为 div[role=button]：计划未提但 button 内不能嵌套删除按钮（HTML 不允许嵌套交互元素），是必要衍生改动
- 计划中「statusLabel 等其余逻辑」实际包含删除：statusLabel 局部变量仅服务于被删的通知 add，删后保留会报 unused
- 补充了 service 配套单测（计划未列）

#### 改动文件清单
- electron/main/agents/tools/delegation-tools.ts
- electron/main/agents/delegation-bridge.ts
- electron/main/services/notification-center-service.ts
- electron/main/services/notification-center-service.test.ts
- electron/main/main-app.ts
- electron/main/tipc/notifications.ts
- stores/notification-store.ts
- components/NotificationCenter.tsx

### 给下一步的接力棒
- 关键签名：service 新增 `remove(id): Promise<void>`、`clearAll(): Promise<void>`、`pruneExpired(maxAgeMs = 24h): Promise<number>`；tipc 新增 `notificationRemove({ id })`、`notificationClearAll()`；store 新增 `remove(id)`、`clearAll()`；广播仍走 persist → notificationsChanged
- 消息中心现存来源只剩：task-queue.ts / task-service.ts 的任务待审核/中断/失败（系统级），验证噪音治理效果时重启应用后旧 conversation 类通知不会再新增（存量可手动清空或等 24h 自动过期）
- 下个 step 从 step4 计划文档继续
- 待办或已知限制：pruneExpired 只在启动时跑一次（长驻期间过期的已读条目要等下次启动才清），计划未要求运行中周期清理
