---
step: 3
title: 通知中心收敛与治理
status: pending
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
- [ ] `delegation-tools.ts`：删 SendMessage 内的交付通知 add 调用（含上面 resolve parentConv 的辅助代码若仅为此服务）
- [ ] `delegation-bridge.ts` notifyTerminalToParent：删 add 调用（保留注入与 statusLabel 等其余逻辑）
- [ ] `notification-center-service.ts`：加 `remove(id)`、`clearAll()`、`pruneExpired(maxAgeMs = 24h)`（只清已读且超龄的）；主进程启动时机调用 pruneExpired（找 service 初始化/首消费点，懒加载 instance 首次创建时跑一次亦可）
- [ ] tipc 路由：加 `notificationRemove({ id })`、`notificationClearAll()`（与现有 notification list/markRead 路由同文件同风格，广播 notificationsChanged）
- [ ] `stores/notification-store.ts`：加 remove/clearAll，本地过滤后更新
- [ ] `NotificationCenter.tsx`：顶部「全部已读」旁加「清空」按钮（confirm-store showConfirm 确认后执行）；条目 hover 显示删除小按钮（X 图标，阻止冒泡避免触发跳转）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
