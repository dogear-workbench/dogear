---
step: 2
title: Edit 行级差分
status: pending
---

## 目标
Edit 工具从「整块红绿」升级为行级差分视图（上下文淡显/删除红/新增绿/行内词级高亮），收起态摘要显示 `+N −M 行`。

## 依赖上下文（接力棒输入）
- 前置 step 产出：（执行后回填）
- 当前关键文件状态：`components/agent-chat/tool-renderers/FileChangeRenderer.tsx` edit 分支约 88-105 行（oldText 整块 pre 红 + newText 整块 pre 绿）；`components/ToolBlock.tsx` 的 `getToolSummary` Edit 分支调 `getEditCount`
- 关键决策回顾：零依赖自写——jsdiff 的 `diffWords` 按空格分词，连续中文被当单个词退化成整行高亮；前后缀裁剪法对中文天然细粒度。不用 git diff（渲染层不能起子进程）。

## 计划改动
- [ ] 新建 `components/agent-chat/tool-renderers/line-diff.ts` 纯函数模块：
  - `diffLines(oldText: string, newText: string): Array<{ type: 'context' | 'add' | 'remove'; text: string }>` — 按行拆分 + LCS，输出统一差分序列
  - `inlineDiff(oldLine: string, newLine: string): { head: string; oldMid: string; newMid: string; tail: string }` — 公共前后缀裁剪，中间为变化区
  - 边界：old/new 任一为空 → 全行单色；行数 > 500 降级为整块替换显示并提示；LCS 输入超长（如单行 > 10k 字符）跳过行内高亮
- [ ] `FileChangeRenderer.tsx` edit 分支：每个 edit 对渲染差分行列表——上下文行 `text-muted-foreground` 淡显、删除行红底 `−` 前缀、新增行绿底 `+` 前缀；删除/新增行内调用 `inlineDiff` 对 head/tail 正常色、oldMid/newMid 加重底色；红绿底**双态写法**（亮色 `bg-red-50 text-red-900` + `dark:bg-red-950/40 dark:text-red-300` 同理绿色）
- [ ] `FileChangeRenderer.tsx` 导出 `getEditLineStats(toolInput): { added: number; removed: number }`（多处 edit 合计）；`ToolBlock.tsx` getToolSummary Edit 分支改为 `文件名 · +N −M 行`
- [ ] 验证：debug 窗口（`/debug`）或真实会话触发一次多行 Edit，确认差分行与行内高亮正确

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
