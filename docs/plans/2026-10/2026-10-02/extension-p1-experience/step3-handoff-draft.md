---
step: 3
title: 移交草稿引用
status: pending
---

## 目标
浏览器一键移交不再直接注入会话消息，改为前端草稿：输入框上方渲染待发送引用块（标题+URL+快照折叠），用户编辑补意图后随消息发出；通知改为「待编辑提醒」。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 后 popup 移交按钮连接前也可见（等连接自动建立）；本 step 不动扩展侧任何文件，handoff 帧（page_handoff: url/title/selectionText?/textExcerpt?）结构不变
- 当前关键文件状态：
  - `electron/main/services/browser/extension-handoff.ts`：`routeBrowserHandoff(handoff)` 查 `latestAliveConversation()` → 有目标即 `session.sendMessage(用户消息文本)` + 通知中心 type conversation 到达通知；无目标 type task「未找到会话」
  - `electron/main/tipc/browser.ts`：`registerExtensionHandoffBridge()` 把 routeBrowserHandoff 挂到 setHandoffHandler
- 关键决策回顾：草稿累加（同会话多条移交排队）；引用块固定拼在用户文本之前；目标会话路由口径不变（最近活跃存活会话）
- 前端现状需先摸清：会话输入区组件路径、输入框草稿状态管理方式（实施时从 components/ 会话输入组件入手，设计文档只定了渲染形态）

## 计划改动
- [ ] 新建 `stores/handoff-draft-store.ts`：`{ conversationId → HandoffDraft[] }`（HandoffDraft = { id, title, url, excerpt?, createdAt }），actions：addDraft / removeDraft / clearFor，selector getDrafts(conversationId)
- [ ] `extension-handoff.ts`：routeBrowserHandoff 有目标分支改为——`session.sendMessage` 删除，改为 tipc 向渲染层广播事件（payload: conversationId + handoff 字段）+ 通知中心 type conversation 文案改「浏览器移交待编辑：{title}」；无目标分支不变
- [ ] `electron/main/tipc/browser.ts`：新增渲染层订阅/广播通道（参照现有 browser 状态广播的接线模式，如 setExtensionStatusBroadcaster 的实现）；handoff 广播经此发出
- [ ] 前端：订阅广播 → `handoff-draft-store.addDraft`；会话输入区上方渲染待发送引用块列表（标题+URL，快照折叠展开），每条可删；发送动作组装消息文本 = 引用块（标题/URL/快照，格式沿用现有「来自浏览器一键移交」模板）+ 用户输入文本，发送成功后 clearFor(conversationId)
- [ ] 通知中心点击跳转目标会话逻辑保持（type conversation + owner 已支持）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
