# 会话渲染五项修复与改进 设计

**背景**：用户反馈会话渲染层一批问题：思考块折叠按钮偶发不显示、代码块黑底不搭主题且字体小无复制、笔记工具卡片长内容被截断无滚动、路径点击靠猜 cwd 经常对不上、Write 摘要用字节数不直观。工具调用整体布局保持现状不改（默认摘要行 + 点开详情的分层已符合「只关心结果」的使用模式）。

**目标**：
1. 修复折叠按钮偶发缺失（bug）
2. 代码块改为融入暖米色主题的浅色卡片 + 复制按钮 + 字号提升，笔记编辑器代码块同步
3. 笔记工具卡片段落可滚动查看
4. 路径胶囊只渲染「确定」的路径（绝对路径 + 落在已知工作区内），不再用工作区根目录猜相对路径
5. Write 摘要从字节数改为行数

## 改动 1：CollapsibleBlock 折叠检测统一基准

**根因**：`CollapsibleBlock.tsx` 检测是否需要折叠用 `computedStyle.lineHeight × previewLines + 4px`（thinking 块 19.5px 行高 × 3 + 4 ≈ 62.5px），而预览区截断用 CSS `${previewLines × 1.4}em`（= 50.4px）。内容高度落在 (50.4, 62.5) 区间（约 3 行的思考）时被截断但判定「无需折叠」→ 箭头 opacity-0、点击无效。

**做法**：effect 实测行高后把 clamp 值存 state（`clampPx`），预览区 `maxHeight` 与 needsCollapse 判定共用该 px 值（容差 +4px 只保留在判定侧）。初始渲染前一帧沿用 em 估计值，effect 后修正。

## 改动 2：代码块浅色卡片化

**hljs 主题**：新建 `src/hljs-theme.css` 替代 `highlight.js/styles/github-dark.css`（从 MarkdownRenderer.tsx 移除 import）。自写 token 配色映射主题暖色系（浅色默认 + `.dark` 变体），背景/前景用 `var(--card)` / `var(--foreground)`：

| token | 浅色 | dark |
|---|---|---|
| keyword / tag name | #A6533C（呼应 primary） | #E8836A |
| string | #5C7A3F | #A3C07E |
| comment | #8C857A italic | #7E8894 italic |
| number / literal | #B07D2B | #D9A85F |
| title / function | #3D6A8E | #7FA8D0 |
| attr / variable | #7A5C9E | #B295D9 |

**pre 样式**（MarkdownRenderer.tsx 的 pre 覆盖）：`relative rounded-lg border border-border bg-card my-3 overflow-x-auto p-3.5 text-[13px] font-mono`，替换 `bg-gray-900 text-gray-100`。

**复制按钮**：pre 覆盖内加右上角按钮（`absolute top-2 right-2`，默认 opacity-0、`group-hover/code` 浮出），点击 `navigator.clipboard.writeText`（内容取自 pre ref 的 textContent），成功切 Check 图标 1.5s。用 `span + onClick` 规避 button 嵌套（pre 内无 button，可直接用 button）。

**行内 code**：MarkdownRenderer components 加 `code` 覆盖——无 `language-` className 的（行内）给 `rounded bg-muted px-1 py-0.5 text-[0.9em] font-mono`；块内 code（有 language-/hljs class）不干预，样式由 pre 控制继承。

**编辑器同步**（globals.css:589 `.notes-editor .ProseMirror pre`）：`#0d1117/#e6edf3` 黑底改为 `var(--card)` 底 + `1px solid var(--border)` 边框卡片（编辑器无语法高亮扩展，仅容器样式对齐）；字号 `0.875em` → 13px。

## 改动 3：NoteCardRenderer 段落滚动

`PreviewSection` 的 `line-clamp-3` 改为 `max-h-40 overflow-y-auto`，与 OutputBox 行为一致，长内容可滚动查看全文。

## 改动 4：路径胶囊只认绝对路径

**原则**：会话工具参数中的相对路径基准是 agent 当时 cwd（子会话/Bash 各不相同，渲染层拿不到），不猜；只有绝对路径且解析后落在已知工作区内才可点。

**做法**（path-link.tsx）：
- `PATH_TOKEN_RE` 删除相对路径分支（`[A-Za-z0-9...]*[\\/]...` 第二支），只匹配盘符/斜杠开头的绝对路径 token
- `resolvePathInWorkspace` 默认拒绝相对候选（开头非盘符/斜杠直接 return null），所有工具块调用点（PathText / KeyValueList / OutputBox / FileChangeRenderer / ToolBlock Edit 预览）行为统一：相对 → 纯文本
- **例外**：MarkdownRenderer 的 md 相对链接（`a` 覆盖里 `openPathPreview`）保留相对解析——该场景仅 plan 文档预览开启，baseDir（文档所在目录）明确可信。实现：`resolvePathInWorkspace` 加 `allowRelative` 参数（默认 false），仅此处传 true

## 改动 5：Write 摘要行数

ToolBlock.tsx `getToolSummary` Write 分支：`写入 ${formatByteSize(content)}` → `写入 ${content.split('\n').length} 行`（与 Edit 的 `+N −M 行` 语言统一）。`formatByteSize` 无其他消费方则连同导出删除（Grep 确认）。

## 模块边界

- `components/agent-chat/CollapsibleBlock.tsx` — 改动 1
- `src/hljs-theme.css`（新建）、`components/MarkdownRenderer.tsx`、`src/globals.css` — 改动 2
- `components/agent-chat/tool-renderers/NoteCardRenderer.tsx` — 改动 3
- `components/agent-chat/path-link.tsx`、`components/MarkdownRenderer.tsx`（a 覆盖传 allowRelative）— 改动 4
- `components/ToolBlock.tsx`、`components/agent-chat/tool-renderers/FileChangeRenderer.tsx` — 改动 5

## 错误处理 / 边界情况

- 折叠检测：`lineHeight` 取不到（'normal'）沿用 20px fallback；流式更新时 children 引用变化自动重测
- 复制按钮：clipboard API 失败静默（toast 可选）；流式中的代码块照常可复制当前内容
- 行数统计：空 content 边缘（Write 空 content 摘要不显示行数段）
- 路径：Windows 盘符大小写已有 lowercase 比较，不变；`..` 归一化逻辑保留（绝对路径内也可能含 `..`）

## 未决问题

- hljs 配色具体色值实施时可微调（上表为基准）
