---
step: 4
title: 申报卡与任务面板双向连接
status: done
---

## 目标
会话 ↔ 任务面板双向可达：申报卡状态徽章可点定位任务；任务面板条目可跳执行会话。

## 依赖上下文（接力棒输入）
- 关键文件状态：
  - `components/agent-chat/TaskReportMessage.tsx`：已有 `openTask()`（switchTab NOTES_TAB_ID + requestTaskFocus），当前只绑在「打开任务」链接；状态徽章为纯 span（statusBadgeClass）
  - `components/notes/TaskPanel.tsx`：任务列表渲染，无任何会话跳转；任务数据含 `execSessionId`（见 `electron/main/services/task-queue.ts:59` 的通知侧用法；渲染层任务类型定义处确认字段名，可能叫 execSessionId 或 conversationId）
  - 跳转工具：`openOrFocusConversation`（`components/conversation-list/utils`，NotificationCenter.tsx:87 现成用法，含跨 workspace 处理）
- 关键决策回顾：用户拍板「双向连接」；徽章不删（承载状态语义），连接是增强

## 计划改动
- [x] `TaskReportMessage.tsx`：状态徽章 span 改 button（保留 statusBadgeClass 样式 + cursor-pointer + hover 微亮），onClick 复用 openTask；「打开任务」链接保留（双入口无妨）或合并（执行时看排版定，倾向保留）
- [x] `TaskPanel.tsx`：任务条目（或展开详情区）加「执行会话」入口——有 execSessionId 时显示，点击反查 conversation（本地 store → client.getByWorkspaceId 兜底，workspaceId 取当前）后 `openOrFocusConversation`；查不到（会话已删）则 toast 提示；无 execSessionId（plan/backlog 态）不显示入口
- [ ] 验证：任务进入 review 后，从申报卡徽章 → 任务面板定位 → 条目跳回执行会话 全链路走通（子会话仅完成静态验证：lint 0 errors / tsc exit 0，运行时全链路待主会话验收）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① TaskPanel 反查按 `c.id` 而非 session_id——execSessionId 实为 conversationId（会话稳定主键，见 docs/plans/2026-08/2026-08-31/notes-tasks-fixes/plan.md「会话稳定主键统一」决策与 TaskDetail 既有跳转用法），不能复用 AgentCommCard 按 session_id 反查的 usePeerConversation，只复用其导出的 jumpToPeerConversation 跳转口径；② 详情区已有「查看执行会话」入口（TaskDetail.tsx 既有），列表条目入口为新增，双向链路完整
- 改动文件清单：
  - `components/agent-chat/TaskReportMessage.tsx`：状态徽章在 canOpen 时渲染为 button（复用 openTask + statusBadgeClass + hover:brightness-95），不可点场景（无 taskId / 无 workspacePath）保留纯 span；「打开任务」链接保留
  - `components/notes/TaskPanel.tsx`：新增 ExecSessionLink（本地 store 按 c.id 反查 → client.getByWorkspaceId 兜底 → jumpToPeerConversation；查不到 toast「执行会话不存在或已删除」）；挂载在 TaskCardItem 元信息行时间戳后，有 execSessionId 才显示，onClick/onKeyDown stopPropagation 避免触发条目 onOpen

### 给下一步的接力棒
- 关键签名 / 数据结构：`jumpToPeerConversation(conv: Conversation): void`（AgentCommCard.tsx 导出）＝ openOrFocusConversation(conv, topic:{groupId}:{id})；Task.execSessionId?: string（types/task.ts，实为 conversationId）
- 下个 step 该从哪里继续：按 plan.md 顺序取下一个 step；本 step 无遗留代码待办
- 待办或已知限制：运行时全链路（review 任务 → 徽章定位 → 条目跳回会话）待主会话跑应用验收；任务取消（cancelCollabTask）保留 execSessionId，故部分 backlog 条目也会显示「执行会话」入口（能看历史执行会话，属预期）
