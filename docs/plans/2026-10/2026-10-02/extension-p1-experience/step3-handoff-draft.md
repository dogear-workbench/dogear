---
step: 3
title: 移交草稿引用
status: done
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
  1. HandoffDraft 存 selectionText / textExcerpt 两字段而非单一 excerpt：两者在消息模板中是独立行（选中内容/正文快照），合并会丢信息、发送时无法还原模板；渲染时同属一个折叠区，展示语义与计划的「快照折叠」一致
  2. clearFor 时机为「组装即消费」（组装 textBlocks 后立即清），非字面的「发送成功后」：与现有全部引用类型（文章/片段/文件等）行为完全一致；发送失败重试丢引用是既有引用体系已接受的限制，不为本 step 单独发明恢复语义
  3. 主进程 buildHandoffText 模板函数迁移到前端 useSendMessage（直发删除后主进程无消费方），格式逐行保持不变
- 改动文件清单：
  - `electron/main/services/browser/extension-handoff.ts`：setHandoffDraftBroadcaster + HandoffDraftBroadcast 类型；有目标分支删 sendMessage 改广播；通知 title 改「浏览器移交待编辑：{title}」（空降 url）；latestAliveConversation 保留 getSession 存活筛选，HandoffTarget 删 session 字段
  - `electron/main/tipc/renderer-handlers.ts`：新增 browserHandoffReceived 事件类型（payload: HandoffDraftBroadcast）
  - `electron/main/tipc/browser.ts`：registerExtensionHandoffBridge 接线 setHandoffDraftBroadcaster → broadcastToWindows
  - `stores/handoff-draft-store.ts`（新）：draftsByConversation + addDraft/removeDraft/clearFor，底部照 browser-store 模式订阅 browserHandoffReceived
  - `components/agent-chat/hooks/useSendMessage.ts`：读锚定本会话草稿，每条独立 textBlock（格式沿用旧模板）拼在 shunt 之后、用户文本之前，组装后 clearFor；空检查与依赖数组补 draft
  - `components/agent-chat/ChatInputArea.tsx`：输入框上方渲染青色系引用块（Globe 图标+标题+URL，选中内容/正文快照折叠展开，每条可删）；Addon 显示条件与发送按钮显示条件补 handoffDrafts

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 广播事件 `browserHandoffReceived`，payload `HandoffDraftBroadcast = { conversationId, url, title, selectionText?, textExcerpt? }`
  - `HandoffDraft = { id: 'handoff-{ts}-{seq}', title, url, selectionText?, textExcerpt?, createdAt }`，store 按 conversationId 累加排队
  - 消息模板（前端组装）：`来自浏览器一键移交：\n标题：{title|(无标题)}\nURL：{url}[\n选中内容：…][\n正文快照：…]`
- 下个 step 该从哪里继续：本 step 无后续依赖项；若做真机验证，重点在「移交→通知点击→跳会话→引用块可见→发送后块消失→会话里出现完整模板文本」全链路
- 待办或已知限制：
  - 草稿对应会话被删除时不主动清理（内存态，重启即清，残留无害）
  - 通知 dedupeKey 仍为 `handoff:{conversationId}`，同会话连续多条移交的通知可能被去重吞掉（既有通知行为，未改）
