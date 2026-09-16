---
step: 2
title: 工具块统一块级命中反馈
status: done
---

## 目标
命中落在任何工具块（普通工具卡 + 四种特殊卡）时：跳转到位、卡片描边、自动展开（已有链路补齐）、卡片头部显示「命中 n 处」徽标。

## 依赖上下文（接力棒输入）
- 前置 step1 产出：useMessageSearch 重扫语义稳定（本 step 不依赖其内部实现，仅依赖 matches 结构不变：id = `${messageId}-${blockIndex}-${hit}`）
- 现状：`ContentBlockItem.tsx:186-208` 四种特殊卡（dogear__ReportTaskResult→TaskReportMessage / dogear__TrackUserActions→UserActionsCard / dogear__SendMessage→AgentCommCard / dogear__CreateSession|CreateSessionBatch→SessionDispatchCard）直接 return，未接收 searchHit
- 现状：普通工具卡走 `ToolBlock.tsx:493-494`（`forceOpen={searchHit} highlighted={searchHit}`），无命中数显示
- 现状：`isBlockActive(activeMatchId, messageId, blockIndex)`（`components/agent-chat/highlight.ts:19`）为前缀匹配，可复用
- 视觉规范（全局决策）：描边用 `outline-1 outline-offset-2 outline-sky-400/70 bg-sky-50/60 dark:bg-sky-950/30`

## 计划改动
- [x] `AgentChat.tsx`：从 `search.matches` + `search.activeMatch` 计算 `activeBlockMatchCount: number`（激活项所在 `messageId+blockIndex` 分组的命中总数，无激活时 0），随 `searchQuery`/`activeMatchId` 同链路下传
- [x] `MessageItem.tsx`：299 / 529 / 543 三处 `ContentBlockItem` 调用点中转 `activeBlockMatchCount`（实际现状：MessageItem 一处 + ToolGroupBlock 一处，两条链路均已中转）
- [x] `ContentBlockItem.tsx`：props 增加 `activeBlockMatchCount`；四种特殊卡传 `searchHit`（用现有 `isBlockActive`）与 `activeBlockMatchCount`；普通 ToolBlock 调用点也补传
- [x] 四张特殊卡（`TaskReportMessage.tsx` / `UserActionsCard.tsx` / `AgentCommCard.tsx` / `SessionDispatchCard.tsx`）：props 增加 `searchHit?: boolean` 与 `activeMatchCount?: number`；根元素条件挂描边 class；头部（标题行）显示「命中 n 处」徽标（仅 searchHit 时）；有展开态的卡补强制展开（AgentCommCard、SessionDispatchCard Single/Batch，`open={expanded || searchHit}`）
- [x] `ToolBlock.tsx`：标题行加同款「命中 n 处」徽标（props 增加 `activeMatchCount`，仅 `searchHit` 时显示）
- [x] 徽标做成小组件 `components/agent-chat/SearchHitBadge.tsx` 供五处复用，样式与卡片描边同色系（sky）
- [ ] 手动验收：搜工具输出里的关键词，逐个 Enter——普通卡与四张特殊卡都能跳到、描边、展开（特殊卡无展开态则只描边+徽标）、显示正确命中数（需 UI 环境，待用户验收）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① step 文档写的「MessageItem 299/529/543 三处调用点」行号过时，实际 MessageItem 一处（~L520）+ ToolGroupBlock 一处，两条链路均已中转；② 中转文件多出 StableHistory / LiveTail / ToolGroupBlock 三个（同链路补全）；③ 有展开态的特殊卡按目标段「自动展开」补齐强制展开（`open={expanded || searchHit}`，与 CollapsibleBlock forceOpen 同模式）；④ 命中时卡片原底色（bg-secondary/60、emerald 系）替换为 sky 底而非叠加（Tailwind bg 叠加顺序不可控）
- 改动文件清单（12 个）：新建 `components/agent-chat/SearchHitBadge.tsx`；修改 `AgentChat.tsx`（activeBlockMatchCount useMemo + 下传）、`StableHistory.tsx` / `LiveTail.tsx` / `MessageItem.tsx` / `ToolGroupBlock.tsx`（中转层）、`ContentBlockItem.tsx`（分发）、`components/ToolBlock.tsx` + 四张特殊卡（描边/徽标/展开）
- 验证：`bun run lint` 0 errors（83 既有 warnings 均为 no-explicit-any）；`bunx tsc -p tsconfig.json --noEmit` 零错误
- 待人工验收：搜工具输出关键词逐个 Enter，逐卡检查跳转/描边/展开/命中数（需 UI 环境）

### 给下一步的接力棒
- 关键签名 / 数据结构：`SearchHitBadge({ count }: { count: number })`；中转层 props 统一叫 `activeBlockMatchCount`，卡片层统一 `searchHit` + `activeMatchCount`；显示条件由父级控制（`searchHit && activeMatchCount > 0`）；`AgentChat.tsx` 中 `activeBlockMatchCount` useMemo 紧跟 search 解构之后（~L317），step3 挪 SearchBar 时保留
- 下个 step 该从哪里继续：step3 改 `AgentChat.tsx`（SearchBar 挪位）与 `SearchBar.tsx` / Minimap
- 待办或已知限制：① 命中停留期间特殊卡手动收起暂无效（跳到下一命中即恢复，与 CollapsibleBlock forceOpen 同模式）；② 描边/徽标仅激活块显示（符合全局决策，非激活命中块无视觉标记）；③ UI 手动验收未做（无浏览器环境）
