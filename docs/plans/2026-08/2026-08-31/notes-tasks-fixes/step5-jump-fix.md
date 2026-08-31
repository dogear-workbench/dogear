---
step: 5
title: 会话定位修复
status: pending
---

## 目标
`jumpToSourceConversation` 在目标会话未开 tab 时不再 toast「来源会话未打开」，而是走完整打开链路（查会话 → openTab → 焦点联动），独立窗口场景 focus 窗口——让笔记来源跳转、任务执行会话跳转真正可达。

## 依赖上下文（接力棒输入）
- 前置产出：无（独立步骤）。
- 当前关键文件状态：
  - `lib/reference-guard.ts:119-133` — `jumpToSourceConversation`：仅 `getTab()` 命中才 switchTab，未命中 toast「来源会话未打开」；独立窗口分支 toast 提示不跳转
  - `stores/conversation-store.ts` — `conversations` 分片为当前工作区全量（loadConversations 拉取）；`selectConversation(conv)` 同步 action；`activeTabId` 变化有焦点联动订阅（:887 起：tab 属其他工作区自动 setWorkspace 再 focusConversationById）——**跨工作区切换已由该联动兜底，本步无需手写**
  - `components/conversation-list/utils.ts:78-88` — `openOrFocusConversation(conv, nodeId?)`：独立窗口 → `client.openSessionWindow`；否则 selectConversation + openTab（可参考其形态，但它 import 了 ConversationList 的类型，直接在 reference-guard 内实现同逻辑更干净，避免 lib → components 依赖）
- 关键决策回顾：note.source / task.originSessionId / task.execSessionId 全是 conversationId（挂载点闭包注入），无需换 key。

## 计划改动
- [ ] `lib/reference-guard.ts` `jumpToSourceConversation` 重写为 async：
  1. tab 已开 → `switchTab` + `requestFocus`（现状保留）
  2. `isInSessionWindow(id)` → `client.openSessionWindow({ conversationId, title })` focus 现有窗口（title 用传入 source.title 或会话标题）
  3. 未开 → `useConversationStore.getState().conversations.find(c => c.id === id)`；列表为空先 `await loadConversations()` 再查（冷启动首跳场景）；命中 → `selectConversation(conv)` + `useSessionStore.getState().openTab(conv.id, 标题, conv.workspace_id)`（标题用 `getConversationTitle(conv)` 语义——该函数在 conversation-list/utils，可复制或动态 import，避免静态依赖 components）
  4. 仍未命中 → toast「会话不存在或已删除」
  - openTab 返回 false（tab 满）时已有 store 层 toast，直接返回
- [ ] 调用点签名适配：`NoteEditor.tsx:229`（`onClick={() => jumpToSourceConversation(note.source!)}`）与 `TaskDetail.tsx:212`（同款同步调用）——改 `void jumpToSourceConversation(...)` 兼容 async；接口参数 `{ conversationId, title }` 不变
- [ ] `client.openSessionWindow` 确认存在且语义为「已开则 focus」（查 `lib/client.ts` / `electron/main/tipc/windows.ts`；若只有「新开窗口」语义，独立窗口分支维持 toast 提示并注明）

## 验证
- `bun run dev`：笔记详情点来源图标 → 会话 tab 打开并聚焦（目标会话此前未开 tab）
- 任务详情「查看执行会话」→ 同上
- 目标会话在独立窗口时 → 主窗口动作触发该窗口 focus
- 会话已删除 → toast 兜底

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
