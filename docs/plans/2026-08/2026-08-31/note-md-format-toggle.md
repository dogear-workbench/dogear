# 笔记编辑器：Markdown 粘贴修复 + 选中区域格式一键渲染/清除

## 背景与根因

### 症状
1. 从外部（VS Code 等）复制的 md 内容粘贴进笔记不渲染，原样显示纯文本
2. 编辑时快捷语法（`# `、`**` 等）有时不触发渲染

### 根因（已查证）
- **症状 1 铁证**：tiptap-markdown 的粘贴解析挂在 ProseMirror `clipboardTextParser` 钩子，该钩子只在剪贴板**无 HTML** 时被调用（`prosemirror-view/dist/index.cjs:2700` `asText = !!text && (plainText || inCode || !html)`）。VS Code / Typora / Obsidian / 网页复制时剪贴板都带 `text/html` → 走 HTML 解析分支 → md 解析被跳过。纯文本源（记事本）反而正常，形成「时好时坏」观感。
- **症状 2 机制**：Tiptap input rule 只在文本块开头匹配（前面有字符不触发）、行内标记需闭合、中文 IME 组合上屏绕过检测。属机制特性，本次不修，靠方案 B 手动兜底。

## 改动

### A. MarkdownPasteGuard 扩展（修粘贴根因）

新文件 `components/notes/tiptap/markdown-paste-guard.ts`：

- `Extension.create({ name: 'markdownPasteGuard' })`，`addProseMirrorPlugins` 里返回带 `props.handlePaste(view, event)` 的 Plugin（Extension 内 `this.editor` 可用，避开 useEditor options 闭包时序问题）
- `handlePaste` 逻辑：
  1. 读 `event.clipboardData` 的 `text/plain` 与 `text/html`；无 text、或无 html（纯文本粘贴已走既有 `clipboardTextParser` 路径）→ `return false` 放行默认
  2. `looksLikeCodeEditorHtml(html)`：DOMParser 解析后，body 内出现富文本语义元素（`p, h1-h6, table, img, a, strong, em, ul, ol, blockquote`）→ false；否则要求有 `pre/code` 元素或带 `style*="color"` 的 span（VS Code 语法高亮特征）→ true
  3. `looksLikeMarkdown(text)`：文本含 `#{1,6} `、`**`、`- [ ]`、列表标记、围栏代码块等特征（多行正则）
  4. 两者都满足 → `event.preventDefault()`，用 `editor.storage.markdown.parser.parse(text, { inline: true })` 生成 HTML，`elementFromString`（本地实现一行，包未导出）+ `DOMParser.fromSchema(view.state.schema).parseSlice(el, { preserveWhitespace: true })`，`view.dispatch(view.state.tr.replaceSelection(slice))`，`return true`
- 安全性：编辑器内部复制（ProseMirror schema HTML，非 pre 包裹）不会被误判；从本编辑器复制代码块再粘贴 → text/plain 是 md 围栏序列化，接管后按 md 解析回代码块，结果等价
- `TiptapEditor.tsx` extensions 数组加入该扩展

### B. BubbleToolbar「按 Markdown 渲染」（快速添加格式）

`components/notes/tiptap/BubbleToolbar.tsx` 加按钮（lucide `WandSparkles`，title「按 Markdown 渲染」）：

```ts
const renderAsMarkdown = () => {
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, '\n');
  const html = (editor.storage as ...).markdown.parser.parse(text, { inline: true });
  editor.chain().focus().insertContentAt({ from, to }, html).run();
};
```

`insertContentAt` 对字符串默认按 HTML 解析，正好消费 parser 输出。选中无 md 语法时重新解析无害。

### C. BubbleToolbar「清除格式」（快速取消格式）

同文件加按钮（lucide `RemoveFormatting`，title「清除格式」）：

```ts
editor.chain().focus().clearNodes().unsetAllMarks().run();
```

`clearNodes` 把标题/列表/引用/代码块降为段落（内容保留），`unsetAllMarks` 清粗斜/行内代码/删除线/链接。B、C 与现有五个 mark 按钮之间加分隔线（竖线样式）。

## 验收

1. VS Code 里写一段含标题/加粗/列表/代码块的 md，复制 → 粘贴进笔记 → 自动渲染
2. 从网页复制一段富文本 → 粘贴 → 保持富文本原样（不被降级成 md 解析）
3. 粘贴一段未渲染的 md 原文（造旧数据）→ 全选该段 → BubbleToolbar 点「按 Markdown 渲染」→ 变富文本
4. 选中一段已渲染内容 → 点「清除格式」→ 变纯文本段落，内容不丢
5. 记事本纯文本 md 粘贴 → 仍走既有解析路径正常渲染（回归）
