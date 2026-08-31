---
step: 1
title: 编辑器三修
status: done
---

## 目标
修复 Tiptap 编辑器三处体验 bug：表格无法删除（无操作入口）、代码块浅底白字看不清、`/` 插入菜单在屏幕下方时溢出（只向下展开）。

## 依赖上下文（接力棒输入）
- 无前置依赖，独立步骤。
- 当前关键文件状态：
  - `components/notes/TiptapEditor.tsx` — extensions 已挂 `TableKit`（Table/TableRow/TableHeader/TableCell 聚合），未挂 columnResizing；`SlashMenu` / `BubbleToolbar` 为子组件。
  - `components/notes/tiptap/SlashMenu.tsx:24-33` — `position()` 用 `Math.min(rect.bottom + 8, ...)` 向下展开，首次弹出量不到高度（React 未 commit）。
  - `src/globals.css:381-394` — `.notes-editor .ProseMirror pre { background: var(--muted) }` 未覆盖字色，prose 给 pre 的字色是浅色 → 浅底浅字。
- 关键决策回顾：浮条样式复用 `.notes-bubble`（globals.css:280 起），不新造样式体系。

## 计划改动
- [ ] `components/notes/TiptapEditor.tsx`：确认 TableKit 是否内置 columnResizing（查 node_modules `@tiptap/extension-table` 的 TableKit 导出）；未内置则显式引入 columnResizing 扩展；挂载新组件 `<TableToolbar editor={editor} />`（与 BubbleToolbar 同级）
- [ ] 新建 `components/notes/tiptap/TableToolbar.tsx`：
  - 监听 editor `selectionUpdate` + `transaction`，`editor.isActive('table')`（含空选区光标在表内）时显示浮条
  - 定位：从当前 selection 的 `$pos` 向上找 table 节点深度，`view.nodeDOM(pos)` 拿表格 DOM，浮条 absolute 挂编辑器滚动容器内、top 对齐表格元素顶部（`offsetTop`）
  - 按钮组（title 提示中文）：删除表格 `deleteTable` / 删行 `deleteRow` / 删列 `deleteColumn` / 上方插行 `addRowBefore` / 左侧插列 `addColumnBefore`，全部 `editor.chain().focus().xxx().run()`
  - className="notes-bubble"，浮出/隐藏带 transition
- [ ] `src/globals.css`：
  - `.notes-editor .ProseMirror pre` 深色化：`background: #0d1117; color: #e6edf3`（对齐聊天区 github-dark 风格）；如需 `pre code` 继承补 `color: inherit`
  - `.notes-editor .ProseMirror .column-resize-handle` / `.selectedCell` 样式（columnResizing 官方推荐 CSS，参考 @tiptap docs：handle 2px 竖线 + selectedCell 淡蓝背景）
- [ ] `components/notes/tiptap/SlashMenu.tsx` position() 重写：
  - `mount()` 里 `root.render(...)` 后用双 `requestAnimationFrame` 再调 `position()`（等 React commit 完成量到真实高度）
  - 向下空间不足（`rect.bottom + 8 + h > window.innerHeight`）时向上弹：`top = Math.max(8, rect.top - h - 8)`
  - 左侧 clamp 逻辑保留；补 window `resize` 监听（与现有 scroll 监听同生命周期）

## 验证
- `bun run dev:renderer` 手动走查：插入表格 → 光标入表 → 浮条出现 → 删行/删列/删表格全通；拖列宽生效
- 代码块输入内容，浅色/深色主题下均清晰可读
- 编辑器滚到视口底部输入 `/`，菜单向上弹不溢出；window resize 时菜单位置跟随

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - columnResizing 无需显式引入：TableKit 内置 `resizable` 配置项（true 且 editable 时自动挂 columnResizing 插件），仅需 `TableKit.configure({ table: { resizable: true } })`。
  - 定位实现用 getBoundingClientRect 差值（容器 relative + absolute）而非 offsetTop，不依赖 offsetParent 链，效果一致。
  - 按钮用文字标签（删行/上插行等）+ 中文 title：lucide 无直观对应图标；样式归入 `.notes-table-toolbar button`，未新造体系。
- 改动文件清单：
  - 新建 `components/notes/tiptap/TableToolbar.tsx`
  - `components/notes/TiptapEditor.tsx`（TableKit resizable + 挂载 TableToolbar）
  - `components/notes/tiptap/SlashMenu.tsx`（双 rAF + 向上弹 + resize 监听）
  - `src/globals.css`（.notes-editor relative、pre 深色化 + code inherit、columnResizing CSS、.notes-table-toolbar）
- 验证：`bun run lint` 0 errors；tsc 改动文件无错；GUI 走查待用户确认。交付详情见共享区 step1-delivery.md。

### 给下一步的接力棒
- 关键签名 / 数据结构：浮条模式 = `.notes-bubble`（外观）+ 独立定位类（如 `.notes-table-toolbar`）+ portal 到 `editor.view.dom.parentElement` + getBoundingClientRect 差值定位；命令调用统一 `chain().focus().xxx().run()` 且按钮 onMouseDown preventDefault 保选区。
- 下个 step 该从哪里继续：Step 2 任务三栏（types/task.ts 与 task-store.ts 双向同步改）。
- 待办或已知限制：浮条 top 对齐表格顶部会遮挡表头一行（计划如此，嫌遮挡可改表格上方悬浮）；列宽拖拽仅 editable 生效（内置行为）。
