---
step: 2
title: Edit 行级差分
status: done
---

## 目标
Edit 工具从「整块红绿」升级为行级差分视图（上下文淡显/删除红/新增绿/行内词级高亮），收起态摘要显示 `+N −M 行`。

## 依赖上下文（接力棒输入）
- 前置 step 产出：（执行后回填）
- 当前关键文件状态：`components/agent-chat/tool-renderers/FileChangeRenderer.tsx` edit 分支约 88-105 行（oldText 整块 pre 红 + newText 整块 pre 绿）；`components/ToolBlock.tsx` 的 `getToolSummary` Edit 分支调 `getEditCount`
- 关键决策回顾：零依赖自写——jsdiff 的 `diffWords` 按空格分词，连续中文被当单个词退化成整行高亮；前后缀裁剪法对中文天然细粒度。不用 git diff（渲染层不能起子进程）。

## 计划改动
- [x] 新建 `components/agent-chat/tool-renderers/line-diff.ts` 纯函数模块：
  - `diffLines(oldText: string, newText: string): Array<{ type: 'context' | 'add' | 'remove'; text: string }>` — 按行拆分 + LCS，输出统一差分序列
  - `inlineDiff(oldLine: string, newLine: string): { head: string; oldMid: string; newMid: string; tail: string }` — 公共前后缀裁剪，中间为变化区
  - 边界：old/new 任一为空 → 全行单色；行数 > 500 降级为整块替换显示并提示；LCS 输入超长（如单行 > 10k 字符）跳过行内高亮
- [x] `FileChangeRenderer.tsx` edit 分支：每个 edit 对渲染差分行列表——上下文行 `text-muted-foreground` 淡显、删除行红底 `−` 前缀、新增行绿底 `+` 前缀；删除/新增行内调用 `inlineDiff` 对 head/tail 正常色、oldMid/newMid 加重底色；红绿底**双态写法**（亮色 `bg-red-50 text-red-900` + `dark:bg-red-950/40 dark:text-red-300` 同理绿色）
- [x] `FileChangeRenderer.tsx` 导出 `getEditLineStats(toolInput): { added: number; removed: number }`（多处 edit 合计）；`ToolBlock.tsx` getToolSummary Edit 分支改为 `文件名 · +N −M 行`
- [x] 验证：line-diff 纯函数用 bun 临时脚本 22 用例验证全过（含中文前后缀裁剪、空输入、>500 行降级、超长行跳过行内高亮、配对重组）；lint 0 errors；改动文件 tsc 0 错误。UI 视觉层留待 dev 环境人工确认

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `diffLines` 返回类型为 `DiffLine[] | null`（计划写 `Array`）：null 表示超过 500 行上限需降级整块显示，由调用方 FileChangeRenderer 分支处理并提示「内容过长，按整块对比显示」
  - 超过 500 行的降级整块红绿 pre 顺带补写了 dark: 变体（原代码缺失，符合本步双态约定）
  - 新增辅助导出：`splitLines`（供 getEditLineStats 复用行数统计）、`buildDiffRows(oldText, newText): DiffRow[] | null`（diffLines + 相邻 remove/add 配对调 inlineDiff，产出带高亮段的渲染友好结构，组件零逻辑）
  - `getEditCount` 已无引用，按不留死代码原则删除
- 改动文件清单：
  - `components/agent-chat/tool-renderers/line-diff.ts`（新建，~130 行）
  - `components/agent-chat/tool-renderers/FileChangeRenderer.tsx`（edit 分支重写 + DiffRowsView + getEditLineStats，getEditCount 移除）
  - `components/ToolBlock.tsx`（import 及 getToolSummary Edit 分支改 `文件名 · +N −M 行`）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `diffLines(oldText, newText): DiffLine[] | null`，`DiffLine = { type: 'context'|'add'|'remove'; text: string }`，null = 超 500 行降级
  - `inlineDiff(oldLine, newLine): { head, oldMid, newMid, tail }`，公共前后缀裁剪，mid 为变化区
  - `buildDiffRows(oldText, newText): DiffRow[] | null`，`DiffRow = { type; segments: { text; highlight: boolean }[] }`，连续 remove/add 块按下标配对，行长 >10k 跳过行内高亮
  - `getEditLineStats(toolInput): { added, removed }`，多处 edit 合计行数，摘要用
- 下个 step 该从哪里继续：Step 3 直接开工，与本步无文件交集（Step 3 不碰 line-diff.ts / FileChangeRenderer）；Step 5 改暗色变量时本步已双写 dark: 变体（red-950/40、emerald-950/40、mid 底 red-800/60、emerald-800/60），可直接在其上微调
- 待办或已知限制：LCS 为 O(m·n) 内存（500 行上限内约 1MB Uint32Array，可接受）；纯移除/新增无配对行时无行内高亮（设计如此）；UI 视觉效果需 dev 环境人工过目
