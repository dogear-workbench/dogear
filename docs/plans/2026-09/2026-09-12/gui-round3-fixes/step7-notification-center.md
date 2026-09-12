---
step: 7
title: 顶部消息中心
status: pending
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
- [ ] 主进程 notification service：JSON 存储（条目：id/类型/标题/摘要/时间/read/owner{kind:'system'|'conversation', sessionId?}/跳转目标），上限条数与同源聚合，广播 notificationsChanged
- [ ] 写入点接入：notifyTask 三个触发 + review 进入（task-store transition）+ 子会话交付/终态（bridge，归属父会话）
- [ ] tipc 路由：listNotifications / markRead / markAllRead + 变更广播
- [ ] 渲染层：顶栏铃铛 + 未读徽章 + 下拉面板（类型图标/标题/时间/归属名，未读高亮，全部已读）；点击条目 → review 跳任务面板 focus、会话事件跳 openOrFocusConversation（父会话），跳转即已读
- [ ] 重启恢复：未读状态持久化，窗口加载拉初值
- [ ] 验证：申报进入 review 铃铛亮 + 跳转定位；子会话交付出现在中心且归属父会话；toast 行为不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
