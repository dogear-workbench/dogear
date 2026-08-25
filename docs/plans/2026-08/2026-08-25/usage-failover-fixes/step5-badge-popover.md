---
step: 5
title: 徽章弹层重构
status: pending
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

- [ ] `UsageBadge.tsx`：HoverCard 换 Popover（shadcn/ui），点击开/点外关；徽章本体（token + 进度条）不变
- [ ] 弹层内容：
  - 当前轮概览（主体）：最后一条 entry 的 modelUsage 逐桶显示——模型名 · input · output · cacheRead · cacheWrite · 命中率（多模型分行）
  - 流式中提示：本轮未落盘时显示「本轮进行中」+ latestContext 当前占用
  - 底部小字：会话累计（totals 四项）+ 缓存命中率（会话级）
  - 折叠区：UsageByTool（保留现有实现）
- [ ] 删除组件：UsageContextBreakdown、UsageReadActivity、UsagePermissionWaits、UsageByModel、UsageEntryList、UsageEntryRow（确认无其他引用后删，相关 `usage-utils.ts` 里仅被这些组件使用的聚合函数一并清理，aggregateReadActivity 等）
- [ ] `UsageSummaryHeader.tsx` 重构为弹层头部（缓存命中率 + 会话累计 + context），删「API 用时」「首 token」死显示行
- [ ] 清理 `useConversationUsage` / `usage-utils.ts` 中只服务于已删组件的代码路径

## 验证

- 手动：点击徽章弹出、点外关闭；流式中打开显示「本轮进行中」；多模型会话（failover 过的）分行显示正常
- 全局搜确认已删组件无残留引用；lint / 既有测试 / build:renderer

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
