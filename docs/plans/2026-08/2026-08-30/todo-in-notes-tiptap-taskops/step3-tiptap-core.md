---
step: 3
title: Tiptap 编辑器核心替换
status: pending
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
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：（TiptapEditor props 最终形态、安装的包名与版本、扩展清单——Step 4 要在同一路线上加菜单）
- 下个 step 该从哪里继续：
- 待办或已知限制：（往返中发现的可接受差异清单，写明）
