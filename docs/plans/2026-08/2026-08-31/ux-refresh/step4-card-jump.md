---
step: 4
title: 卡片跳转动作
status: pending
---

## 目标
成果卡片标题行加跳转按钮：笔记 → 笔记详情、任务 → 任务深链、子会话 → 打开会话 tab；实体已删/获取失败时静默降级。

## 依赖上下文（接力棒输入）
- 前置 step 产出：（执行后回填，含 Step 3 各 renderer 的入参形状）
- 当前关键文件状态：`components/ToolBlock.tsx` 的 `buildPreviewAction`（约 68 行）产出 Eye 预览按钮挂 `headerActions`；`stores/task-focus-store.ts` 有 `focusReq { taskId, seq }` 深链基建（通知在用）；`stores/notes-store.ts` 有 `setActiveNoteId`；`stores/session-store.ts` 有 `NOTES_TAB_ID` 哨兵与 `switchTab`；`components/conversation-list/utils.ts` 有 `openOrFocusConversation(conv, nodeId)`
- 关键决策回顾：跳转动作**统一在 ToolBlock 层产出**（与 previewAction 同层，二者可并存），renderer 保持纯展示——避免 renderer 反向控制标题行的架构问题。

## 计划改动
- [ ] `ToolBlock.tsx` 新增 `buildResultAction(toolName, toolInput, toolOutput, workspaceId)` 与 buildPreviewAction 同构，返回 `{ icon: ExternalLink, tooltip, open }`：
  - 笔记类：`switchTab(NOTES_TAB_ID)` + `setActiveNoteId(noteId)`（CreateNote 的 toolOutput 含 noteId；Update/Append 的入参含 noteId）
  - 任务类：`CreateTask` 出参/taskInput 含 taskId → `task-focus-store` focusReq seq++；确认 task-focus 消费端是否含切 tab，若只切 mode 则先 `switchTab(NOTES_TAB_ID)`
  - 子会话：出参 sessionId/conversationId → `client.getById` 取 Conversation → `openOrFocusConversation(conv, nodeId)`；失败 catch 后返回 null（按钮不渲染）
- [ ] `headerActions` 渲染区支持 preview + jump 两个按钮并存（现有 span 按钮结构复用）
- [ ] 边界：笔记/任务已删（调用对应 get 失败或列表无此项）时按钮隐藏或 toast；子会话归属其他工作区时 openTab 的 workspaceId 参数用会话自身值
- [ ] 验证：真实触发各跳转——笔记 tab 打开且选中卡片、任务 mode 选中目标、子会话 tab 打开高亮列表节点

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
