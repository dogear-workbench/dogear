---
step: 6
title: 顶栏收口组装与 e2e
status: pending
---

## 目标

NotesPanel 骨架收口：四 mode 顶栏、分域搜索常驻、笔记卡片会话化、标签过滤合流搜索行、删旧组件，最后 e2e 走查全动线。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step3 TodosPanel（props 含 query）、step4 TrashView（props 含 query）、step5 TaskPanel backlog 分组
- 现状：`components/notes/NotesPanel.tsx` 双 mode（笔记/任务）+ 笔记内二级 tab（时间流/待办/标签/回收站）+ mode 内搜索框；`NoteCardItem.tsx` 右侧按钮容器常驻占位
- 关键决策：二级切换整排撤掉；标签 tab 与 TodosView 删除；搜索框常驻四域分发

## 计划改动

- [ ] `components/notes/NotesPanel.tsx`：
  - MODES 改四项：笔记 | 待办 | 任务 | 回收站；任务 review 徽章保留
  - 搜索框常驻，按 mode 分域：笔记走 searchNotes（query+tag 叠加）、待办/任务/回收站传 query 给对应面板（内部 store 过滤）
  - 右侧按钮：笔记 mode 显「新建卡片」，其余隐藏
  - 笔记 mode 左侧二级切换撤掉，时间流独占列表区；回收站视图从列表区移除（mode 已有）
- [ ] `components/notes/NoteCardItem.tsx` 会话列表化（照 `components/conversation-list/ConversationRow.tsx:100`）：标题独占全宽 truncate；meta 行 = 相对时间 + hover 浮出引用/删除（`ml-auto`、`opacity-0 pointer-events-none → group-hover:opacity-100`）；移除标签 Badge
- [ ] 搜索行 `#` 标签下拉：列出全部标签带计数（数据从 notes store 聚合），点选过滤、选中变 chip 显示于搜索框旁可单独点掉，与 query 叠加（复用 searchNotes tag 参数）
- [ ] 删除 `components/notes/TodosView.tsx`、`components/notes/TagsView.tsx` 及其引用
- [ ] e2e 走查：
  - 存卡动线：新对话聊方案 → 存卡（无 todos）→ agent 落 backlog → 任务 tab 点执行 → 队列跑完 review
  - 待办动线：手动快速建（due 过期标红）/ 聊天让 agent 记 / 勾完成 / 软删 → 回收站恢复
  - 搜索四域各自过滤正确；# 标签 chip 与关键词叠加
  - 回收站三段恢复/彻底删除
- [ ] doc-sync 同步 `docs/codebase-map.md`

## 验收

- 四 mode 切换各自独立可用；笔记详情打开关闭不再有撑大回归（NoteEditor 未动，走查确认）
- 时间流卡片样式与会话列表一致；标签不再出现在卡片上

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
