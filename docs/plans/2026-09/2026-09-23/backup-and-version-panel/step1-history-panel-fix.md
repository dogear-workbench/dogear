---
step: 1
title: 文件历史面板修复
status: done
---

## 目标

修复首轮真人体验发现的两处缺陷：选中版本的完整描述无处可看、diff 全量渲染大文件不可用。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无（本步独立，可先行）
- 当前关键文件状态：
  - `components/FileHistoryPanel.tsx`（~290 行）：Dialog 双栏，左侧 w-72 时间线（条目描述 `truncate` 截断于 :241 附近），右侧顶部仅一行差异统计 + 恢复按钮
  - `lib/line-diff.ts`：`diffLines()` 只裁剪首尾公共行，中间公共行全量输出 `DiffRow[]`
  - `components/file-history/HistoryDiffView.tsx`：渲染全部 rows，>5000 行截断
- 关键决策回顾：LCS 核心不动（已验证正确），折叠纯在输出层做；详情头放右侧顶部（左侧保持紧凑截断）

## 计划改动

- [ ] `components/FileHistoryPanel.tsx` 右侧顶部改为版本详情头：徽标（Agent/你/恢复前/外部）+ 完整时间（含秒）+ 完整消息（`whitespace-pre-wrap` 不截断）+ hash 短显 + 差异统计（+x/-y）；恢复按钮保留在详情头右侧；未选中时显示占位提示
- [ ] `lib/line-diff.ts` 新增 `buildHunks(rows: DiffRow[], contextLines = 3): HunkSection[]`：把连续 same 行折叠为 `{ kind: 'fold'; count: number }` 段，差异块保留上下 3 行上下文；`HunkSection = DiffRow | { kind: 'fold'; count: number }`；`diffLines()` 本体不改
- [ ] `components/file-history/HistoryDiffView.tsx` 改为接收 `sections: HunkSection[]`，折叠条渲染「⋯ 省略 N 行」，点击展开该段（组件内 state 记录已展开段索引），展开后显示原行
- [ ] 最早版本（全新增、无 older）保持全量新增展示，同样过 hunk 折叠（对纯新增无非 fold 段，天然成立）
- [ ] `bun run lint` 通过；主窗口与会话窗口两宿主均挂载（无需改动挂载点，改的是面板内部）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：仅一处 —— fold 段类型在计划的 `{ kind: 'fold'; count: number }` 基础上增加 `rows: DiffRow[]` 字段（被折叠的原始行）：「点击展开后显示原行」必须有原行数据，仅靠 count 无法恢复；count 语义不变。其余与计划一致。
- 改动文件清单：
  - `lib/line-diff.ts`：新增 `DiffFold` / `HunkSection` 类型与 `buildHunks()`（LCS 与 `diffLines()` 本体未动）
  - `components/file-history/HistoryDiffView.tsx`：props 从 `rows` 改为 `sections`；行渲染抽出 `DiffRowView`；折叠条「⋯ 省略 N 行」点击展开/收起；截断改按渲染单元计数
  - `components/FileHistoryPanel.tsx`：右侧顶部改为版本详情头（徽标/含秒完整时间/完整消息 whitespace-pre-wrap/hash 短显/差异统计 +x/-y/恢复按钮），未选中显示占位；`useMemo` 计算 sections 并以 `key={selectedIndex}` 重建 `HistoryDiffView` 使展开状态随版本切换重置；folder/too-large/error 文案移入 diff 区

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `HunkSection = DiffRow | { kind: 'fold'; count: number; rows: DiffRow[] }`，用 `'kind' in s` 区分
  - `buildHunks(rows, contextLines = 3)`：差异行 ±3 行上下文内的 same 行保留，连续可折叠 same 段合并为一个 fold
  - `HistoryDiffView({ sections }: { sections: HunkSection[] })`；`FileHistoryPanel` 侧 `sections = useMemo(() => diff.kind === 'ok' ? buildHunks(diff.rows) : [], [diff])`
  - 详情头信息源：`describeEntry()` + 新增 `formatTimeFull()`（含年月日秒）
- 下个 step 该从哪里继续：step2 按计划文档继续（备份服务相关）
- 待办或已知限制：展开后的行计入 MAX_RENDER_ROWS（5000）截断额度；fold 展开状态仅存组件内 state，重新打开面板后重置（预期行为）
