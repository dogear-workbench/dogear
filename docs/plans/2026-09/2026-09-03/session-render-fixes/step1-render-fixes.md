---
step: 1
title: 五项渲染修复一次落地
status: done
---

## 目标

按 [design.md](./design.md) 完成全部五个改动点，验证通过。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-09/2026-09-03/session-render-fixes/design.md`（含根因分析与色值表，实施前通读）
- 关键现状：
  - `components/agent-chat/CollapsibleBlock.tsx` — 检测用 computedStyle px、截断用 em，两套基准不一致（根因详见 design.md 改动 1）
  - `components/MarkdownRenderer.tsx:6` import 了 `highlight.js/styles/github-dark.css`；pre 覆盖在 `bg-gray-900 text-gray-100`
  - `src/globals.css:589` `.notes-editor .ProseMirror pre` 黑底 `#0d1117`，编辑器无 hljs 扩展（只改容器样式）
  - `components/agent-chat/path-link.tsx` — `PATH_TOKEN_RE` 含相对路径第二分支；`resolvePathInWorkspace` 相对候选拿 workspacePath 拼根
  - `components/ToolBlock.tsx` getToolSummary Write 分支用 `formatByteSize`（从 FileChangeRenderer 导入）

## 计划改动

- [x] **改动 1** `components/agent-chat/CollapsibleBlock.tsx`：effect 实测行高后将 clamp px 存 state，预览区 maxHeight 与 needsCollapse 共用同一 px 值（判定侧 +4px 容差保留）；初始帧沿用 em 估计值
- [x] **改动 2a** 新建 `src/hljs-theme.css`：按 design.md 色值表写浅色默认 + `.dark` 变体的 hljs token 配色，背景/前景用 `var(--card)` / `var(--foreground)`
- [x] **改动 2b** `components/MarkdownRenderer.tsx`：移除 github-dark.css import，改为 import 新主题；pre 覆盖改 `relative rounded-lg border border-border bg-card my-3 overflow-x-auto p-3.5 text-[13px] font-mono`；pre 内加右上角复制按钮（hover 浮出，clipboard 写入 pre textContent，成功切 Check 1.5s）；components 加 `code` 覆盖——无 `language-` class 的行内 code 给 `rounded bg-muted px-1 py-0.5 text-[0.9em] font-mono`，块内 code 不干预
- [x] **改动 2c** `src/globals.css:589` `.notes-editor .ProseMirror pre`：黑底改 `background: var(--card); border: 1px solid var(--border); color: var(--foreground)`，字号 0.875em → 13px（`pre code` 的 `color: inherit` 保留）
- [x] **改动 3** `components/agent-chat/tool-renderers/NoteCardRenderer.tsx` PreviewSection：`line-clamp-3` → `max-h-40 overflow-y-auto`
- [x] **改动 4** `components/agent-chat/path-link.tsx`：`PATH_TOKEN_RE` 删相对路径分支只匹配绝对 token；`resolvePathInWorkspace` 加 `allowRelative?: boolean` 默认 false（相对候选直接 return null）；`components/MarkdownRenderer.tsx` a 覆盖里 `openPathPreview` 的 resolve 调用传 true（plan 文档 baseDir 可信场景）
- [x] **改动 5** `components/ToolBlock.tsx` getToolSummary Write 分支改 `写入 N 行`（`content.split('\n').length`，空 content 不显示行数段）；`formatByteSize` 若无剩余消费方（Grep 全仓确认）则从 `FileChangeRenderer.tsx` 删除导出与实现
- [x] 验证：`bun run lint`、`bun run dev:renderer` 启动无报错

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异，全部 7 项按计划落地。两个实现细节：
  - 复制按钮采用 design 允许的 button（pre 内无嵌套问题），图标 Copy/Check 来自 lucide-react
  - code 覆盖的块内判定除 `language-`/`hljs` class 外，补充「内容含换行」判定，堵住无语言标注围栏代码块被误判为行内 code 的漏洞（符合 design「块内 code 不干预」意图）
- 改动文件清单：
  - `components/agent-chat/CollapsibleBlock.tsx`（改动 1：clampPx state 统一判定与截断基准）
  - `src/hljs-theme.css`（新建，改动 2a）
  - `components/MarkdownRenderer.tsx`（改动 2b + 4：CodeBlock 组件 + 行内 code 覆盖 + a 链接 resolve 传 allowRelative=true）
  - `src/globals.css`（改动 2c：notes-editor pre 卡片化）
  - `components/agent-chat/tool-renderers/NoteCardRenderer.tsx`（改动 3）
  - `components/agent-chat/path-link.tsx`（改动 4：PATH_TOKEN_RE 只留绝对分支 + allowRelative 参数）
  - `components/ToolBlock.tsx`（改动 5：Write 摘要行数）
  - `components/agent-chat/tool-renderers/FileChangeRenderer.tsx`（改动 5：删 formatByteSize）
- 验证：`bun run lint` 0 errors / 99 warnings（均为既有 no-explicit-any，与本次无关）；`bun run dev:renderer` 启动无报错，全部改动模块经 Vite 按需转换返回 200（含 `@/src/hljs-theme.css` 解析）

### 给下一步的接力棒
- （本计划仅一步，回填后直接写 plan.md 完成总结）
