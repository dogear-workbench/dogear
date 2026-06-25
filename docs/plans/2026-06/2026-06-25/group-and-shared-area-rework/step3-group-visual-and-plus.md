---
step: 3
title: GroupCard 视觉降级 + 组内 + 按钮
status: done
---

## 目标

让组在视觉上退到背景：去 Layers 图标、字号收一档、加淡底让会话区像被框住。同时给组卡片头部加 `+` 按钮，作为「在该组新建对话」的唯一入口。

## 依赖上下文（接力棒输入）

- 前置 step：Step 2（保证每个对话都有 groupId、Toolbar 已纯化）
- 关键现状：
  - `components/group-list/GroupCard.tsx:95` `<Layers className="w-4 h-4 ..." />` 待删
  - `components/group-list/GroupCard.tsx:60` `handleNewConversation` 已有完整逻辑（创建对话 + selectConversation + openOrFocusConversation + loadConversations + auto expand），直接复用
  - `components/group-list/GroupCard.tsx:84-132` header div 当前 padding `py-2 pr-3 pl-2`，字号 `text-sm`，hover 背景 `hover:bg-muted/30`
  - More 按钮在 line 116-131（保留，右键菜单依然有用）
- 用户对视觉的原话：「图标不要了就只要名称，可以稍微再窄一些，加一点深色的颜色，让用户聚焦于会话，组的作用只是让我清楚知道哪些会话是一组的」
  - 译：去图标 / 行高更紧凑 / 标题用 muted 色 / 让会话行视觉权重高于组标题

## 计划改动

- [ ] `components/group-list/GroupCard.tsx`：
  - 删 `<Layers />` 图标 + import
  - 删 import 中无引用的 Lucide 图标
  - Header 样式调整建议：
    - padding：`py-2 pr-3 pl-2` → `py-1 pr-2 pl-2`（窄一档）
    - 标题字号：`text-sm` → `text-xs`，颜色 `text-muted-foreground`（弱化）
    - 选中态背景从 `bg-blue-50/50` 改 `bg-muted/40`（不抢蓝色，蓝色留给会话行）
  - Header 右侧 More 按钮**前面**加一个 `+` 按钮：
    - `<Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); handleNewConversation(); }} title="在组内新建对话"><Plus className="w-3 h-3" /></Button>`
  - 不动 ContextMenu 内容（保留「在组内新建对话」菜单项作为冗余入口）

## 验证

- 列表里组卡片标题没有 Layers 图标，颜色比对话标题淡，行高更紧
- 选中组时背景是 muted 灰，不抢眼；下方对话行高亮（蓝/灰）依然清晰
- hover 组卡片头部 → 右侧出现 `+` 按钮 → 点击 → 该组里出现一条新对话并被选中
- `bun run build && bun run lint` 通过

## 实施回填（做完后填）

### 实际改动

- `components/group-list/GroupCard.tsx`：
  - import 改 `Layers` → `Plus`
  - 删 header 中的 `<Layers />` 图标
  - Chevron 图标 `w-3.5 h-3.5` → `w-3 h-3`（与文字收一档对齐）
  - Header padding `py-2 pr-3 pl-2` → `py-1 pr-2 pl-2`
  - 选中态背景 `bg-blue-50/50 dark:bg-blue-900/20` → `bg-muted/40`
  - 标题字号 `text-sm` → `text-xs text-muted-foreground`
  - 编辑态 input 字号同步 `text-sm` → `text-xs`
  - More 按钮**前面**插入 `+` 按钮（lucide `Plus`、`h-6 w-6 p-0`、`opacity-0 group-hover:opacity-100`），onClick `handleNewConversation()`，复用现有逻辑
  - ContextMenu 内「在组内新建对话」菜单项保留

### 给下一步的接力棒

- GroupCard UI 已定型；后续 Step 4/5 不再动 GroupCard
