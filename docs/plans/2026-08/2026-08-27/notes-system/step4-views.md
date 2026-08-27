---
step: 4
title: 视图完善——待办聚合/标签/回收站/搜索
status: pending
---

## 目标

视图栏四个视图全部可用：待办聚合视图（agent 实施队列的人类侧入口）、标签过滤、回收站、搜索框。

## 依赖上下文（接力棒输入）

- 前置 step 产出：读 step3 实施回填，拿 notes-store 现有 action 与 NotesPanel 视图栏结构（step2 建的 disabled 占位）
- 数据能力已就绪：step1 的 `listTodos({status?, hasPlan?})`、`searchNotes({query?, tag?})`、`listTrash`/`restoreNote`/`purgeNote` tipc 路由
- 「可实施待办」判定 = todo 有 `plan` 字段（设计文档「执行纪律」节）

## 计划改动

- [ ] `components/notes/TodosView.tsx`：聚合所有卡未完成待办
  - 分组：「可执行（有 plan）」在前、「普通待办」在后；组内按卡片聚合显示来源卡片标题（点击跳卡片详情）
  - 待办行：勾选（updateNote 置 done）、状态徽标（pending/in_progress）、plan 路径可点击（一期只展示完整路径文本，跳转 plan 编辑器不做）
- [ ] `components/notes/TagsView.tsx`：标签列表（计数）→ 点标签过滤时间流
- [ ] `components/notes/TrashView.tsx`：.trash 列表 + 恢复 + 彻底删除（彻底删除走 confirm-store 的 `showConfirm()`，**禁止 window.confirm**）
- [ ] 搜索框：NotesPanel 顶栏，输入 300ms 防抖调 searchNotes，结果替换时间流列表
- [ ] `components/notes/NotesPanel.tsx`：视图栏四项全部启用，视图切换为组件内 state（不落盘）

## 验证

- 应用内手测：造 3 张卡（含带 plan 待办/普通待办）→ 待办视图分组正确、勾选回写卡片 → 标签过滤 → 删一张卡进回收站 → 恢复/彻底删除（确认弹窗出现）→ 搜索关键词命中

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
