---
step: 1
title: 修两个 UI bug（重命名/新建闪烁）
status: done
---

## 目标

消灭两个跟主重构无耦合的 UI bug：右键重命名秒退、新建对话整列表被 spinner 替换。设计文档「附带修复」节有完整根因分析。

## 依赖上下文（接力棒输入）

- 前置 step：无（本 step 是入口）
- 关键根因回顾（详见 `../group-and-shared-area-rework-design.md` 的「附带修复」段）：
  - Bug A：Radix `ContextMenu` 关闭时异步 `onCloseAutoFocus` 把焦点抢回 trigger，晚于 `setTimeout(0)` 的 input.focus()，导致 input 立即 blur 触发 `saveTitle` → `setIsEditing(false)`
  - Bug B：`ConversationList.tsx:48` 无条件渲染 spinner，`loadConversations` 一启动就 `loadingConversations: true`，刷新场景下整列表消失
- 现状关键代码位置：
  - `components/conversation-list/ConversationRow.tsx:108` ContextMenu + `:145` `onBlur={saveTitle}` + `:71` `setTimeout(focus,0)`
  - `components/group-list/GroupCard.tsx:82` ContextMenu + `:107` `onBlur={saveTitle}` + `:37` `setTimeout(focus,0)`
  - `components/ConversationList.tsx:48-55` 无条件 loadingConversations 判断

## 计划改动

- [ ] `components/conversation-list/ConversationRow.tsx`：`<ContextMenuContent>` 加 `onCloseAutoFocus={(e) => e.preventDefault()}`
- [ ] `components/group-list/GroupCard.tsx`：`<ContextMenuContent>` 加 `onCloseAutoFocus={(e) => e.preventDefault()}`
- [ ] `components/ConversationList.tsx:48`：判断改成 `if (loadingConversations && conversations.length === 0)`

## 验证

- 重命名：右键任一组卡片 / 对话行 → 点「重命名」→ input 出现并保持焦点，能输入；Esc 取消、Enter 保存、点别处保存
- 新建（暂时只能通过 Toolbar 顶部按钮 + FolderPlus 触发，因为 Step 2-3 还没改交互）：点「新建对话」→ 列表区不被 spinner 替换，新对话直接出现
- `bun run build && bun run lint` 通过

## 实施回填（做完后填）

### 实际改动

- `components/conversation-list/ConversationRow.tsx:189` `<ContextMenuContent>` 加 `onCloseAutoFocus={(e) => e.preventDefault()}`
- `components/group-list/GroupCard.tsx:134` `<ContextMenuContent>` 加 `onCloseAutoFocus={(e) => e.preventDefault()}`
- `components/ConversationList.tsx:48` 判断改成 `if (loadingConversations && conversations.length === 0)`
- `bun run lint` 0 errors

### 给下一步的接力棒

- 改动无外溢，三处都是局部增量。
- ContextMenuRow / GroupCard 行号已轻微漂移，下个 step 改 GroupCard 时注意行号以最新文件为准。
