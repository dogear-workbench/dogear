# 会话渲染五项修复 实施计划

**目标**：修复折叠按钮偶发缺失、代码块浅色卡片化（含编辑器同步 + 复制按钮）、笔记工具段落滚动、路径胶囊只认绝对路径、Write 摘要改行数。

**架构思路**：五个独立小改动一次做完（详见 [design.md](./design.md)），全部在前端渲染层，不涉及主进程与数据结构。

**涉及模块**：`components/agent-chat/CollapsibleBlock.tsx` / `components/MarkdownRenderer.tsx` / `src/hljs-theme.css`（新建）/ `src/globals.css` / `components/agent-chat/tool-renderers/NoteCardRenderer.tsx` / `components/agent-chat/path-link.tsx` / `components/ToolBlock.tsx` / `components/agent-chat/tool-renderers/FileChangeRenderer.tsx`

## 步骤索引

- [x] [Step 1: 五项渲染修复一次落地](./step1-render-fixes.md) — 按 design.md 五个改动点全部实施并验证

## 完成总结

五项修复全部落地（详见 [step1-render-fixes.md](./step1-render-fixes.md) 实施回填段）：折叠检测统一 px 基准（CollapsibleBlock clampPx state）、代码块浅色卡片化（新建 src/hljs-theme.css + CodeBlock 复制按钮 + 行内 code 胶囊 + 编辑器同步）、笔记工具卡片段落可滚动（max-h-40）、路径胶囊只认绝对路径（resolvePathInWorkspace 加 allowRelative，仅 md 链接例外）、Write 摘要改行数（删 formatByteSize）。lint 0 errors、dev:renderer 无报错。遗留：hljs 色值可按视觉评审微调（只动 src/hljs-theme.css）。

## 全局决策

- 不写注释；改动遵循 design.md 的色值与行为约定
- `resolvePathInWorkspace` 新增 `allowRelative` 参数默认 false，仅 MarkdownRenderer 的 a 链接覆盖处传 true
- 路径白名单扩展名（`ALLOWED_EXT_RE`）、大小写归一比较、`..` 归一化逻辑均不变
- 完成后跑 `bun run lint` 与 `bun run dev:renderer` 验证无编译错误
