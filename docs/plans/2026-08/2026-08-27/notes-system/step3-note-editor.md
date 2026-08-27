---
step: 3
title: 卡片详情与编辑
status: done
---

## 目标

笔记 Tab 内可新建卡片、查看详情、编辑正文/标签/链接/待办，800ms 防抖自动保存。

## 依赖上下文（接力棒输入）

- 前置 step 产出：读 step2 实施回填，拿 NotesPanel 结构与 notes-store action 签名
- 编辑器：MDXEditor 项目已在用（`@mdxeditor/editor@^4.0.3`，package.json:33），**插件配置照抄速记板** `components/dashboard/ScratchpadSection.tsx:3-30`（headings/lists/quote/thematicBreak/link/linkDialog/markdownShortcut/toolbar 八插件 + UndoRedo/BoldItalicUnderline/BlockTypeSelect/ListsToggle/CreateLink 工具栏）
- 防抖保存范式：ScratchpadSection.tsx:32-59（800ms debounce + 切换 flush + unmount 清理），直接平移
- MDXEditor 非受控特性：换卡时用 ref 重设内容（ScratchpadSection.tsx:35-42 的处理）

## 计划改动

- [x] `components/notes/NoteEditor.tsx`：详情区组件
  - 正文：MDXEditor（插件同速记板），onChange 800ms 防抖 updateNote
  - 元数据区：tags chip 编辑（输入回车增、x 删）；links 编辑（下拉前缀 article:/stock:/plan: + 值输入；plan 类型给文件路径）
  - 待办区：列表（勾选框切 status、文本可编辑、删除按钮）；「加待办」行；待办行展开可填 plan 路径（选填）
- [x] `components/notes/NotesPanel.tsx`：点列表项 → 右侧（或覆盖式）打开 NoteEditor；顶栏「新建卡片」按钮（create 空卡后直接进编辑态）
- [x] `stores/notes-store.ts`：补 `activeNoteId`、`createNote`/`updateNote` action；编辑后本地乐观更新 + notes-changed 事件兜底刷新
- [x] 新建卡片默认 frontmatter：id/created/updated 自动，tags/links/todos 为空数组

## 验证

- 应用内手测：新建 → 写正文（工具栏加粗/列表/链接）→ 加标签/链接/两条待办 → 等 1s 刷新页面数据仍在 → 勾选待办状态持久 → 直接改磁盘上 md 文件的 frontmatter，重开详情生效（验证文件为真源）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 布局采用三栏（视图栏 | 列表 w-72 | 详情 flex-1）而非覆盖式：详情打开时列表保持可见可切换
  2. todo 勾选框做成三态循环（pending → in_progress → done → pending）覆盖全部 status；in_progress 文本琥珀色、done 删除线区分
  3. tags/links/todo 增删与 status 切换立即保存（immediate flush），仅正文与 todo 文本/plan 输入走 800ms 防抖——离散点击立即落盘，输入类操作合并写
  4. 切换工作区自动关闭详情，防跨工作区 noteId 悬空
- 改动文件清单：
  - stores/notes-store.ts（改）：+activeNoteId / setActiveNoteId / createNote / updateNote，导出 NotePatch
  - components/notes/NoteEditor.tsx（新）：详情区组件（元数据区 + 正文 + 待办区）
  - components/notes/NotesPanel.tsx（改）：列表项可点击 + active 高亮、顶栏「新建卡片」、三栏布局

### 给下一步的接力棒
- 关键签名 / 数据结构：见共享区 notes/step3-delivery.md
- 下个 step 该从哪里继续：Step 4（Agent 工具），与本步无代码耦合，仅共享 updateNote 语义
- 待办或已知限制：见共享区 notes/step3-delivery.md
