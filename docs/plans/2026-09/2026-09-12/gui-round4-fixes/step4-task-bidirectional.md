---
step: 4
title: 申报卡与任务面板双向连接
status: pending
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
- [ ] `TaskReportMessage.tsx`：状态徽章 span 改 button（保留 statusBadgeClass 样式 + cursor-pointer + hover 微亮），onClick 复用 openTask；「打开任务」链接保留（双入口无妨）或合并（执行时看排版定，倾向保留）
- [ ] `TaskPanel.tsx`：任务条目（或展开详情区）加「执行会话」入口——有 execSessionId 时显示，点击反查 conversation（本地 store → client.getByWorkspaceId 兜底，workspaceId 取当前）后 `openOrFocusConversation`；查不到（会话已删）则 toast 提示；无 execSessionId（plan/backlog 态）不显示入口
- [ ] 验证：任务进入 review 后，从申报卡徽章 → 任务面板定位 → 条目跳回执行会话 全链路走通

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
