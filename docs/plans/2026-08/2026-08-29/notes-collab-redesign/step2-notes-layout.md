---
step: 2
title: 笔记页骨架与 Bear 化编辑区
status: done
---

## 目标
笔记页从「列表 | 288px 详情栏」重做为「顶栏 + 列表 300px | 完整编辑区」，编辑区 Bear 化：独立标题、小灰 meta 行、760px 正文、聚焦浮现工具栏、待办移出编辑区、键盘流、隐藏列表沉浸。

## 依赖上下文（接力棒输入）
- 设计依据：`../notes-page-redesign-design.md` 架构第 1、2 节
- 前置 step 产出：无直接依赖（本步纯笔记页 UI，与 Step 1 可并行但按序执行）
- 现状事实：`app/page.tsx:291-296` 笔记 Tab 常驻挂载；`NotesPanel.tsx` 列表+详情布局；`NoteEditor.tsx:178-200` header（返回/时间/保存状态/回收站），`activeNoteId ? 'w-72'` 窄栏；`NoteCardItem.tsx:38-65` hover 回收站按钮

## 计划改动
- [ ] `NotesPanel.tsx`：重做骨架——顶栏（`[笔记] [任务]` 切换占位、搜索、＋新建）+ 列表 300px + 详情区 flex；任务切换本期渲染占位 tab（Step 5 接通）
- [ ] `NoteCardItem.tsx`：卡片样式调整（标题+摘要+标签），hover 按钮区预留引用按钮位（Step 3 实装）
- [ ] `NoteEditor.tsx` 重做：
  - 独立标题输入（大字号，新建即聚焦）
  - meta 小灰行：`8/29 · 🔗(来源，Step 3 实装) · #3(标签数，点击行内展开标签芯片与引用列表) · 💬(引用，Step 3 实装)`，tooltip 齐备
  - 正文容器 max-width 760px 居中；`contentEditableClassName` 重做笔记排版（行高/段距/标题层级，替代裸 `prose prose-sm`）
  - 工具栏：编辑区聚焦时顶部浮现轻量条，失焦消失（MDXEditor toolbar 定制/重排，不做 bubble）
  - **移除待办区**（frontmatter todos 不再渲染到编辑区）
  - 保存状态改为 meta 行角落短暂闪现；**顺手修保存失败仍显示「已保存」**：先查根因（保存链路 tipc 返回值 vs 本地状态置位时序）再修
  - 键盘流：Esc 返回列表、Ctrl+Enter 保存并返回；自动保存维持
  - 沉浸：双击分隔条或快捷键隐藏列表（列表宽度动画到 0）
- [ ] 新建动线：＋新建 → 直接进编辑区、标题聚焦（不再先进标签/引用表单）

## 验收
- 编辑区为页面主体；正文 760px 居中、行长舒适；标签/引用默认不可见，点 `#3` 展开
- 待办区消失，正文 `- [ ]` 只是文字
- 聚焦出工具栏、失焦消失；Esc/Ctrl+Enter 工作正常
- 保存失败时状态如实显示
- 隐藏列表后正文独占、再切回正常

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 卡片「摘要」未做：NoteMeta 无摘要字段（index.json 不含正文），本步约束不进主进程，降级为「标题+时间+标签」；后续可在主进程索引加 excerpt
  - meta 行的 🔗（来源）与 💬（会话引用）按钮未渲染（Step 3 实装，不留死按钮）；hover 按钮区容器已预留
  - 沉浸快捷键定为 Ctrl+\（计划未定具体键位）
  - 存量「待办/标签/回收站」视图保留为列表区顶部二级切换（计划未提及去向，删除会丢回收站功能）
- 改动文件清单：
  - `components/notes/NotesPanel.tsx`：骨架重做（顶栏 [笔记][任务] 切换+搜索+新建 / 列表 300px / 分隔条双击+Ctrl+\ 隐藏列表 / 详情区 flex-1，任务 tab 占位）
  - `components/notes/NoteEditor.tsx`：重做（独立标题输入、meta 小灰行、760px 正文、notes-prose 排版、聚焦浮现工具栏、移除待办区、保存状态机重写、Esc/Ctrl+Enter）
  - `components/notes/NoteMetaSection.tsx`（新）：meta 展开区的标签/引用编辑（从原编辑器抽出）
  - `components/notes/NoteCardItem.tsx`：卡片改「标题主体+时间+标签」，hover 按钮区预留引用位，移除待办数
  - `src/globals.css`：`.notes-editor` 聚焦工具栏 CSS（focus-within）+ `.notes-prose` 排版
- 保存 bug 根因：flush 中 `void updateNote().finally(() => setSaving(false))` 从不检查返回值，失败时 saving 复位而 touched 仍 true → header 固定显示「已保存」；且 pendingRef 在请求前置空，失败即丢数据。修法：await 返回值，成功 → saved 闪现 1.5s；失败 → patch 回填 pendingRef（与新输入合并）+ error 态持续显示，下次输入/保存自动重试

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `NoteEditor` props 未变（workspacePath/noteId/onClose/onDelete），父组件仍 key={noteId} 重挂
  - `NoteMetaSection` props：`{ tags, links, onTagsChange, onLinksChange }`，变更即 imme 立即保存
  - 标题模型：frontmatter 无标题字段，标题=正文首个 ATX 标题行；`splitLeadingHeading(content)` 剥离为标题输入，保存时 `joinHeading` 拼回；titleDirty/hadHeading 两 ref 控制「存量无标题笔记不自动前置 H1」
  - `NoteEditor.saveState: 'idle' | 'saving' | 'saved' | 'error'`，显示在 meta 行右侧
- 下个 step 该从哪里继续：Step 3 在两处挂引用按钮——`NoteCardItem` hover 按钮容器（已留空 div）、`NoteEditor` meta 行（日期与 #N 之间）；锚定数据走 reference-store 的 NoteReference API（Step 1 已备）
- 待办或已知限制：
  - MDXEditor 内部 dialog 若在自己处理 Esc 后未阻止冒泡，按 Esc 会同时关闭 dialog 并返回列表（已用 defaultPrevented 防御，radix 层是否 preventDefault 未逐版本验证）
  - 工具栏随内容滚动（MDXEditor topArea sticky 受包含块限制），长文中部不可见；换 Tiptap 时升级气泡
  - 并发 flush 乱序写回风险与原版相同（同字段旧盖新，低概率），未加锁
