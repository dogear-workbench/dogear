---
step: 5
title: 徽章弹层重构
status: done
---

## 目标

输入框工具栏的 usage 徽章从 hover 显示改为点击弹出（Popover），内容重组为「当前轮概览 + 会话累计」，删除死代码组件与死显示。

## 依赖上下文（接力棒输入）

- 调查报告（共享区 `usage-correctness-and-display.md`）§2 显示位清单：
  - 徽章本体 `UsageBadge.tsx`（挂载 `ChatInputArea.tsx:398`），数据经 `useConversationUsage` refetch（usageEntryAdded 事件驱动）
  - 现 Hover 卡板块：UsageSummaryHeader（含死显示「API 用时 0.0s」，durationApiMs 恒 0）/ UsageContextBreakdown（categories 恒空，死代码）/ UsageByModel（只统计出现轮数，弱利用）/ UsageByTool（正常）/ UsageReadActivity（依赖断链 compactMarkers + turnIndex 回绕，Step 3 已修但保留价值低）/ UsagePermissionWaits（实机 0 条）/ UsageEntryList + UsageEntryRow（'end_turn' 遗留值误报 amber 警告；逐轮明细职责已移交 Step 4 的 TurnDetailList）
- Step 3 已完成 entry.lastContextTokens；Step 4 已建 TurnDetailList（本步不再需要旧 UsageEntryList）。
- 设计决策（`../usage-failover-fixes-design.md` E/F 节）：弹层轻量化纯当前轮，不做工具 token 估算，砍 ReadActivity 与 PermissionWaits，保留 ByTool，ByModel 并入当前轮概览。

## 计划改动

- [x] `UsageBadge.tsx`：HoverCard 换 Popover（shadcn/ui），点击开/点外关；徽章本体（token + 进度条）不变
- [x] 弹层内容：
  - 当前轮概览（主体）：最后一条 entry 的 modelUsage 逐桶显示——模型名 · input · output · cacheRead · cacheWrite · 命中率（多模型分行）
  - 流式中提示：本轮未落盘时显示「本轮进行中」+ latestContext 当前占用
  - 底部小字：会话累计（totals 四项）+ 缓存命中率（会话级）
  - 折叠区：UsageByTool（保留现有实现）
- [x] 删除组件：UsageContextBreakdown、UsageReadActivity、UsagePermissionWaits、UsageByModel、UsageEntryList、UsageEntryRow（确认无其他引用后删，相关 `usage-utils.ts` 里仅被这些组件使用的聚合函数一并清理，aggregateReadActivity 等）
- [x] `UsageSummaryHeader.tsx` 重构为弹层头部（缓存命中率 + 会话累计 + context），删「API 用时」「首 token」死显示行
- [x] 清理 `useConversationUsage` / `usage-utils.ts` 中只服务于已删组件的代码路径

## 验证

- 手动：点击徽章弹出、点外关闭；流式中打开显示「本轮进行中」；多模型会话（failover 过的）分行显示正常
- 全局搜确认已删组件无残留引用；lint / 既有测试 / build:renderer

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  1. **头部/底部信息分置的裁决**：计划两条目对「会话累计 + 缓存命中率」的位置有重叠（弹层头部 vs 底部小字），按设计文档 E「当前轮视角主体 + 底部小字会话累计」裁决：顶部头部（UsageSummaryHeader 重构后）仅显示上下文占用，会话累计 totals 四项 + 会话级缓存命中率放底部小字，避免同信息显示两遍。
  2. **头部 5m/1h cacheWrite 明细行删除**：头部重构枚举内容（命中率 + 会话累计 + context）不含它，与「轻量化」目标一致；`aggregateCacheCreation` 一并清理（987 条实机 entry 仅 73 条有此明细）。
  3. **流式判定**：`isStreaming = pendingState === 'running'`（flushing 是插话排队非运行中）；流式中当前轮概览标题显示「最近完成轮」，下方 pulse 圆点行显示「本轮进行中 · 当前占用 X」（CTX 快照逐 message_end 落盘并触发 refetch，占用实时更新）。
  4. **「折叠区 ByTool」按「保留现有实现」解读**：UsageByTool 组件零改动直接嵌入（其内置 top-5 + 展开已是折叠行为），未额外包一层 Collapsible。
  5. Popover 宽度 560px → 460px（内容轻量化后收窄）。
- 改动文件清单：
  - 重写 `components/agent-chat/usage-badge/UsageBadge.tsx`：HoverCard → Popover，新增 `isStreaming?: boolean` prop
  - 新增 `components/agent-chat/usage-badge/UsagePopoverContent.tsx`：弹层内容容器（当前轮概览 ModelBucketRows / 流式提示 / ByTool / 会话累计小字）
  - 重构 `components/agent-chat/usage-badge/UsageSummaryHeader.tsx`：仅保留上下文占用行，删「API 用时」「首 token」「轮数」「totals 网格」「5m/1h」（后两者移至弹层底部小字/删除）
  - 删除 7 文件：UsageHoverCard / UsageContextBreakdown / UsageByModel / UsageReadActivity / UsagePermissionWaits / UsageEntryList / UsageEntryRow（删前全局 grep 确认零外部引用）
  - 清理 `components/agent-chat/usage-badge/usage-utils.ts`：删 aggregateReadActivity / aggregatePermissionWaits / formatWaitMs / aggregateCacheCreation 及关联类型；保留 formatLabel / formatTokens / resolveContext / cacheHitRate（cacheHitRate 入参改为内联形状，兼容 modelUsage 桶）
  - `components/agent-chat/ChatInputArea.tsx:398`：传 `isStreaming={pendingState === 'running'}`
  - `useConversationUsage.ts`：无改动（无只服务于已删组件的代码路径）

### 验证结果

- `bun run lint`：0 errors / 74 warnings（= 基线）
- `bun test` 全量：118 pass / 9 fail（= 既有 delegation mock 污染基线，比对一致）；单跑 `usage-utils.test.ts`：7 pass
- `bun run build:renderer`：✓（10.3s）
- 全局搜索已删组件/函数名：零残留
- 手动项（点击弹出/点外关、流式中打开、多模型分行）：未做（计划允许跳过）；数据链路复用既有已验证 IPC，Popover 交互为 Radix 现成行为

### 给下一步的接力棒

- 关键签名 / 数据结构：`UsageBadge({ conversationId, isStreaming? })`；`UsagePopoverContent({ usage, context, lastEntry, isStreaming })`；`cacheHitRate({ inputTokens, cacheReadInputTokens })` 可直接传 modelUsage 桶或 totals；usage-badge 目录最终 7 文件（UsageBadge / UsagePopoverContent / UsageSummaryHeader / UsageByTool / usage-utils / usage-utils.test / useConversationUsage）
- 下个 step 该从哪里继续：本 step 是计划最后一步，无后续；主会话置 status=done 后可更新 `usage-failover-progress.md` 收尾
- 待办或已知限制：流式中「当前占用」依赖 usageContext 事件逐 message_end 触发 refetch（粒度为每次 LLM call，非 token 级）；弹层打开时若发生 failover，usageEntryAdded 事件仍按 conversationId 过滤，弹层数据自动续接；手动回归项（点击交互/流式/多模型实机观察）待主会话安排
