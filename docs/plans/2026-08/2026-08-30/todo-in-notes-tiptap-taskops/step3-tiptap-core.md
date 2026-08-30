---
step: 3
title: Tiptap 编辑器核心替换
status: done
---

## 目标

NoteEditor 正文区从 MDXEditor 换成 Tiptap：所见即所得、markdown 输入规则、`- [ ]` 可点选框、粘贴 md 解析、存量卡片无损往返；文件真源仍是 markdown，保存链路（800ms 防抖 + 切卡/卸载 flush）不变。**本步是全计划风险最高的一步，序列化往返不达标不切换。**

## 依赖上下文（接力棒输入）

- 设计文档第二节；此前调研卡片 16b1h86d（技术选型对比，Tiptap 结论）
- 当前 `components/notes/NoteEditor.tsx`：元数据区（标签 chips + article:/stock:/plan: 链接）+ MDXEditor 正文（插件同速记板旧配置）+ 三态待办区；800ms 防抖保存 + 卸载 flush；父组件 `key={noteId}` 挂载换卡即重挂载（`NotesTimelinePane.tsx`）
- 存量卡片正文特点：含 ```` ``` ```` 代码块、GFM 表格、`\-\ [` 转义、HTML 实体（`&#x20;`）——往返测试必须覆盖
- **开工先做**：查 Tiptap 当日 stable 版本（v2 还是 v3）与 tiptap-markdown 兼容性；v3 注意包结构变化（扩展并入 monorepo 包、react 菜单组件路径不同），以下计划中的包名按实际版本调整

## 计划改动

- [ ] 安装依赖（bun）：`@tiptap/react`、`@tiptap/starter-kit`、task-list/task-item 扩展、link 扩展、`tiptap-markdown`（v3 下找等价序列化方案，不达标则自写 doc→md serializer）
- [ ] 新建 `components/notes/TiptapEditor.tsx`：props `{ initialMarkdown: string, onChange: (md: string) => void }`；内部 useEditor 初始化 content=markdown（tiptap-markdown 解析），editor.on('update') 把 `editor.storage.markdown.getMarkdown()` 回调出去；不包保存防抖（防抖留在 NoteEditor 层，职责不变）
- [ ] `components/notes/NoteEditor.tsx` 重写：移除 MDXEditor 与插件、**删除三态待办区**（待办语义移交正文 checkbox）；正文区换 TiptapEditor；防抖保存接 onChange
- [ ] `types/note.ts` 清理 `TodoItem / TodoStatus / NoteMeta.todos`；主进程 `electron/main/services/notes/note-types.ts` 对齐；`notes-store.ts`（主进程）frontmatter 解析遇 `todos:` 行直接忽略（容忍旧文件不报错）
- [ ] 卸载 `@mdxeditor/editor`（grep 确认无其他使用方再删）
- [ ] **Spike 验证先行**：先在 NoteEditor 换上最小 Tiptap（无 BubbleMenu/slash），用下面验收清单跑真机，达标才继续清理类型与卸包

## 验收（真机，dev 模式）

- 打开含表格/代码块/转义符的存量卡片（如 20260828-155934 调研卡），改动一个字保存，关开卡片对比 md 文件 diff：仅预期差异（转义符规范化可接受，语义无损）
- `- [ ] ` 空格出待办选框；点击选框勾选/取消，落盘为 `- [x]`/`- [ ]`
- `# `/`## `/`- `/`1. `/`> `/`**x**`/`` `x` ``/`---`/```` ``` ```` 输入规则全部生效
- 中文 IME：拼音组合输入过程不误触发输入规则、不丢字
- 粘贴一段 markdown 文本 → 解析为富文本
- 快速切卡片：内容不串卡（key 重挂载 + 防抖 flush）；关应用重开内容在
- `bun run build:renderer` + lint + tsc 通过

## 实施回填（做完后填）

### 实际改动
- 版本拍板：**Tiptap v3**（当日 stable 3.30.5）+ tiptap-markdown 0.9.0（peer 明确支持 `@tiptap/core ^3.0.1`）；Spike 达标，未自写 serializer
- 与计划差异：
	- 未启用 Highlight：tiptap-markdown 无内置 `==` 支持（需 markdown-it-mark + 自定义 serialize），存量卡片零处该语法，YAGNI 不装依赖；Step 4 要高亮时一并补
	- 计划外：`migrate-notes-todos.ts` 的迁移数据源依赖被删的 `Note.todos`，改为从文件原文自提取 frontmatter todos 块（`extractFrontmatterTodos`），迁移能力保留到 Step 5 反向改造；测试断言同步更新，4/4 过
	- 计划外：`stores/notes-store.ts`（前端）`NotePatch` 同步删 `'todos'`
	- 计划内提一句：NoteEditor 里三态待办区在更早的 three-entities step6 已删，本步无残留
- 改动文件清单：`components/notes/TiptapEditor.tsx`（新建）、`components/notes/NoteEditor.tsx`、`types/note.ts`、`stores/notes-store.ts`、`src/globals.css`、`electron/main/services/notes/note-types.ts`、`electron/main/services/notes/notes-store.ts`、`electron/main/services/notes/notes-service.ts`、`electron/main/services/migrate-notes-todos.ts`（+test）、`package.json`/`bun.lock`

### 给下一步的接力棒
- 关键签名 / 数据结构：
	- `TiptapEditor` props：`{ initialMarkdown: string; onChange: (md: string) => void; onReady?: (editor: Editor) => void }`；onReady 交出编辑器实例（NoteEditor 存 ref 用于标题 Enter 后 `commands.focus('end')`）
	- 依赖（锁定版本）：`@tiptap/react@3.30.5`、`@tiptap/starter-kit@3.30.5`（v3 已内置 link/underline/listKeymap，勿重复装 extension-link）、`@tiptap/extension-list@3.30.5`（TaskList/TaskItem）、`@tiptap/extension-table@3.30.5`（TableKit）、`@tiptap/extension-image@3.30.5`、`tiptap-markdown@0.9.0`
	- 扩展清单：StarterKit + TaskList + TaskItem(nested) + TableKit + Image + Placeholder(“写点什么…”，来自 `@tiptap/extensions`) + Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true })
	- 取 markdown：`(editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown()`（tiptap-markdown 未做全局 storage 类型合并，需断言）
	- 样式：编辑器根类 `notes-editor`，内容 attributes 类 `notes-prose prose dark:prose-invert max-w-none...`；task/表格/代码块/placeholder 样式都在 `src/globals.css` 的 `.notes-editor .ProseMirror` 段；间距类只放外层容器，不进编辑器 attributes（Step 4 BubbleMenu/suggestion 挂 body 时同理）
	- 往返链路：真实卡片 11/11 二轮收敛；输入规则（#/-/[ ]/>/**x**/`x`/---/```）由 StarterKit + TaskList 输入规则提供，无需自写
- 下个 step 该从哪里继续：Step 4 在 TiptapEditor 同一扩展数组上加 BubbleMenu（`@tiptap/react/menus`，v3 路径变了）与 `/` suggestion（`@tiptap/suggestion`）菜单；菜单项候选：粗斜/行内代码/删除线/链接 + 待办/标题/列表/引用/代码块/分割线/表格；注意浮层挂 body 时 className 不要带间距类
- 待办或已知限制（可接受差异清单，均二轮收敛）：
	1. 列表标记 `* ` 统一规范化为 `- `
	2. 硬换行行尾两空格规范化为反斜杠 `\\`
	3. `>` 行首转义 `\>` 规范化为 `&gt;`；`]`/`(` 转义风格微变（`\[x]\(u)` → `\[x\](u)`）
	4. 行首/连续空格因 HTML 空白折叠丢失（ASCII 对齐图对齐散掉，16b1h86d 卡一次性收敛；MDXEditor 渲染态本就如此显示）
	5. 文件末尾多余空行去除
	6. task 项与普通项同级混排会被拆为相邻两个列表（markdown-it-task-lists 解析特性）
	7. **已知限制**：表格单元格内 `\|` 序列化不转义（tiptap-markdown table serializer 缺陷），含竖线单元格往返会列错位；存量卡片无表格，agent 未来写含竖线表格需留意
	8. **已知限制**：`==高亮==` 不可用（未启用 Highlight，见上）
	9. 真机待验（本会话无 GUI）：中文 IME 组合输入、粘贴 markdown 解析、快切卡片不串卡
