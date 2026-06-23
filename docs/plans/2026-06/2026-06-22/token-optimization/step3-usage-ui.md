---
step: 3
title: Usage UI 新增维度
status: done
---

## 目标
UsageHoverCard 增加「重读文件」与「权限等待」两个折叠区，加（如可能）缓存类型分布展示，让用户直观看到优化空间。

## 依赖上下文（接力棒输入）
- Step 2 落下的字段：
  - `ConversationUsageEntry.toolActivity?: { calls: ToolCallRecord[]; totalCalls: number }`
  - `ConversationUsageEntry.permissionWaits?: PermissionWaitRecord[]`
  - ToolCallRecord 包含 `{ name, count, files? }`，Read 工具的 files 是命中文件列表
  - PermissionWaitRecord 包含 `{ toolName, decision, waitMs, requestedAt }`
- 当前 UI 模块：`components/agent-chat/usage-badge/`
  - `UsageHoverCard.tsx` 组合下列四块
  - `UsageSummaryHeader.tsx` — 头部：上下文进度 + 缓存命中率 + token 合计
  - `UsageByModel.tsx` / `UsageByTool.tsx` — 模型/工具维度
  - `UsageEntryList.tsx` / `UsageEntryRow.tsx` — 明细
  - `usage-utils.ts` — 派生纯函数

## 计划改动

### A. 重读文件折叠区
- [ ] `usage-utils.ts` 新增聚合纯函数：
  ```ts
  /** 全会话扫一遍 lines，按 file_path 聚合 Read 次数 + 间隔分析 */
  export function aggregateReadActivity(lines: UsageJsonlLine[]): {
    file: string;
    count: number;
    /** 距上次 Read 这个文件，间隔了几个 entry（最近一次） */
    lastIntervalEntries: number | null;
    /** 中间是否有 compact marker */
    crossedCompact: boolean;
  }[]
  ```
  入参用 `UsageJsonlLine[]` 才能识别 CompactMarker；内部遍历筛 entry → toolActivity.calls → name === 'Read' → 展开 files
- [ ] 新增 `UsageReadActivity.tsx`：默认折叠（Top 5 重读文件，count ≥ 2 才显示），展开看全部，按 count 倒序

### B. 权限等待折叠区
- [ ] `usage-utils.ts` 新增：
  ```ts
  export function aggregatePermissionWaits(lines: UsageJsonlLine[]): {
    toolName: string;
    totalCount: number;
    totalWaitMs: number;
    avgWaitMs: number;
    decisions: { allow: number; deny: number; always_allow: number };
  }[]
  ```
- [ ] 新增 `UsagePermissionWaits.tsx`：默认折叠（按 totalWaitMs 倒序，展示 toolName + 累计/平均等待 + 三种决策计数），count = 0 时整块隐藏

### C. UsageHoverCard 集成
- [ ] `UsageHoverCard.tsx` 在 UsageByTool 下方依次插入 UsageReadActivity / UsagePermissionWaits

### D. 缓存类型分布
- [ ] 调研 SDK result.usage 是否暴露 cache_creation 细分（5m / 1h）：
  - 暴露 → UsageSummaryHeader 加一行小字"5m: XX / 1h: XX"
  - 不暴露 → 跳过这部分，记入接力棒待办

## 不在本步范围
- 「数据驱动决定 Phase 4 范围」是用完这层 UI 后的人工动作，不在代码改动里

## 实施回填

### 实际改动
- 与计划差异：
  - **聚合函数入参用 ConversationUsage 而非 UsageJsonlLine[]**：前端 useConversationUsage 只能拿到聚合后的 `ConversationUsage`（entries + compactMarkers + totals），原始 lines 不暴露到渲染层。改成 `aggregateReadActivity(entries, compactMarkers)`，crossedCompact 用 compactMarker.afterTurnIndex 与 turnIndex 区间判断
  - **5m / 1h 缓存细分放在 Summary 头部而非独立小字**：`entry.usage.cacheCreation.ephemeral5mInputTokens / ephemeral1hInputTokens` 已存在（无需 SDK 调研），加 `aggregateCacheCreation(entries)` 纯函数把所有 entry 加和，在 UsageSummaryHeader 第二行"会话缓存命中率"右边追加"写入 5m XX / 1h XX"（hasAnyDetail=false 时整段隐藏，老对话不显示）
  - **PermissionWait decision 显示合并 allow + allow_session**：UI 上 ✓ 徽章合并两者计数（用户视角都是"放过去了"），★ 单独显示 always_allow，✕ 显示 deny
  - **重读文件路径缩短**：超过 2 段的路径只显示 `…/最后两段`，避免徽章过宽；hover 看完整路径
  - **新增 formatWaitMs 辅助函数**：与 UsageSummaryHeader 里的 fmtMs 类似但加了分钟单位（>60s 显 `m:ss`），权限累计可能跨多分钟
- 改动文件清单：
  - `components/agent-chat/usage-badge/usage-utils.ts`：加 `aggregateCacheCreation` / `aggregateReadActivity` / `aggregatePermissionWaits` / `formatWaitMs` 四个纯函数 + 对应类型 `CacheCreationTotals` / `ReadActivityItem` / `PermissionWaitAggregate`
  - `components/agent-chat/usage-badge/UsageReadActivity.tsx`（新建）：重读文件折叠区，count ≥ 2 才显示，Top 5 默认展开按钮；每行显 file / count× / Δ间隔 / RotateCcw 跨 compact 标记
  - `components/agent-chat/usage-badge/UsagePermissionWaits.tsx`（新建）：权限等待折叠区，按 toolName 聚合，按 totalWaitMs 倒序，count=0 隐藏；每行显 toolName / count× / 累计 wait / decision 徽章
  - `components/agent-chat/usage-badge/UsageHoverCard.tsx`：在 UsageByTool 下方依次插入 UsageReadActivity / UsagePermissionWaits
  - `components/agent-chat/usage-badge/UsageSummaryHeader.tsx`：在"会话缓存命中率"行右边追加 5m / 1h 写入累计
- SDK 是否暴露 5m/1h 细分：**已暴露**，`ConversationUsageEntry.usage.cacheCreation.ephemeral5mInputTokens / ephemeral1hInputTokens` 是 Step 2 之前就在的 SDK 原生字段，无需额外采集

### 给下一步的接力棒
- 跑数据观察窗口：建议开 3-5 个真实长会话跑 1-2 周，重点观察：
  - **重读文件 Top N**：是不是同一份 CLAUDE.md / 大文档反复被 Read？是否大多发生在 compact 之后（crossedCompact=true）？→ Phase 4 决定是否做"大文件 Read 截断"
  - **权限等待 Top N**：哪些工具频繁拦人？累计等待时长占整轮 API 用时多少？→ 决定是否要为某些工具加 always_allow 默认或调整 PermissionRequestCard UX
  - **5m vs 1h 写入比例**：若 5m 占绝对大头 → 大概率适合 Phase 3 切 1h 缓存
- 已知限制：
  - `aggregateReadActivity` 的 `lastIntervalEntries` 只反映最近两次读取的间隔（不是平均间隔），跨 compact 的判定也只看最近两次。要看完整时序需要展开 entry 列表手工对照
  - `crossedCompact` 只反映"最近两次读取"是否跨过 compact，不是"曾经跨过任何 compact"。多次 compact 场景下若最新一次未跨，徽章不显示
  - 权限等待按 toolName 聚合，没有按 entry/turn 维度拆分，无法看出"哪一轮等了最久"。要排查具体卡顿 turn 需要打开明细列表看单 entry 的 permissionWaits（当前 UsageEntryRow 未展示该字段，后续可补）
  - cache_creation 5m/1h 字段缺失的 entry（旧 JSONL 或 SDK 未返回）会被跳过；`hasAnyDetail=false` 时整段不显示，避免误显示 0/0
