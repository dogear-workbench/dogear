---
step: 4
title: 设置「用量」Tab
status: done
---

## 目标

设置 overlay 侧栏新增「用量」Tab：按会话汇总 token 的列表（标题/时间/模型/累计），点击展开该会话逐轮明细（TurnDetailList 组件）。

## 依赖上下文（接力棒输入）

- 调查报告（共享区 `usage-correctness-and-display.md`）§2 显示位清单、§3 A/D 节：
  - conversations.json 的 usageSummary（totalInputTokens/totalOutputTokens/totalCacheReadTokens、turnCount）已随会话列表 IPC 传输（`types/electron-api.ts:167`），前端零消费——直接用做列表数据；lastContextSize 已在 Step 3 修正口径
  - 逐轮明细数据源：getUsage IPC（`useConversationUsage.ts:43` 消费模式，按 conversationId 读 JSONL）已现成
  - JSONL ENTRY 字段：turnIndex、timestamp、numTurns（本轮 LLM call 次数）、usage（in/out/cacheRead/cacheWrite）、modelUsage（按模型分桶，含 contextWindow）、toolActivity、terminalReason
- Step 3 已完成：turnIndex 全局单调（分段线的回跳兜底仍保留，防历史数据）、entry 带 lastContextTokens、CompactMarker 落盘。
- 设置页结构参照现有 Tab（「人设」「派遣」等，`app/settings/` 目录），侧栏平级加「用量」。

## 计划改动

- [x] `app/settings/` 新增 `UsageTab.tsx`：侧栏注册新项「用量」
- [x] 会话列表行：标题 · 最后活动时间 · 模型 badge（从 modelSelection/usageSummary 可得模型名的去重集合，若 usageSummary 无模型字段则用 conversation.modelSelection）· 累计 token（totalInput+totalOutput+totalCacheRead）；按最后活动时间倒序；无 usageSummary 的会话（0 轮）显示「—」或灰置
- [x] 孤儿过滤：usage JSONL 对应已删除会话时不展示（以 conversation 列表为准遍历，不遍历文件系统）
- [x] 新组件 `components/usage/TurnDetailList.tsx`（props：conversationId，内部经 getUsage IPC 拉取）：
  - 每轮一行：时间 · 模型（modelUsage 多桶时分行或并列 badge）· input↑ / output↓ · cacheRead / cacheWrite · 命中率（cacheRead/(input+cacheRead)）· 工具调用数（toolActivity.totalCalls）
  - 点击行展开：工具明细（各工具调用次数 + Read 文件列表）· numTurns（LLM 调用次数）· terminalReason 状态（completed=正常绿 / aborted/max_turns=黄 / error=红——修正旧 UsageEntryRow 的 'end_turn' 遗留判定）
  - 分段线：turnIndex 回跳（entry[i].turnIndex <= entry[i-1].turnIndex）或时间差 >30 分钟处画分隔线标注「会话重启/切换」
  - compact marker（Step 3 落盘的 compact 行）渲染为压缩分界行
- [x] 排序直接按 JSONL 文件序（时间序），不依赖 turnIndex 排序键（规避历史数据回绕的排序错乱）

## 验证

- 手动：打开设置 → 用量 Tab，确认列表、展开明细、分段线、压缩分界（若有历史 compact）显示正常
- lint / 既有测试 / build:renderer

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. TurnDetailList 数据拉取直接复用 `useConversationUsage` hook（含 usageEntryAdded 事件自动刷新），未另写拉取逻辑——即计划「参照 useConversationUsage.ts:43 消费模式」的复用形式
  2. UsageTab 列表数据自取 `client.getByWorkspaceId`（现拉现返回 usageSummary），未复用 conversation-store 缓存（store 内列表可能滞后）；同时监听 `conversationListChanged`（过滤当前 workspaceId）与 `usageEntryAdded` 两个事件静默刷新，展开中的会话运行时明细也能滚动更新
  3. 模型 badge 取 `conversation.modelSelection ?? settings.ai.defaultModelSelection` 经 `resolveModelLabel` 解析（usageSummary 无模型字段，按计划回退 modelSelection；两者皆空不显示 badge）；failover 中途切换的历史轮次模型以明细行 modelUsage 桶为准
  4. quota 失败轮选择如实展示（terminalReason=error 红色 + 0 token），不过滤
  5. 明细行展开区额外显示 `lastContextTokens`（轮末上下文，Step 3 新字段，缺失时跳过不显示）——Step 3 接力棒「消费方容错」的首个落地
- 改动文件清单：
  - `components/usage/TurnDetailList.tsx`（新增）：逐轮明细组件，props `{ conversationId: string }`；`buildTimeline` 按 JSONL 文件序（时间序）排布 entries + compactMarkers（合并后按 timestamp 稳定排序），turnIndex 回跳（`<=` 前一条）或时间差 >30min 插「会话重启 / 切换」分段线；`statusOf` 映射 terminalReason（error 红 / aborted、max_turns 黄 / completed 及其余绿）；每行展开显示 numTurns / terminalReason / lastContextTokens / 工具明细（name×count + Read 文件列表）
  - `app/settings/UsageTab.tsx`（新增）：按会话汇总列表（标题 · 最后活动时间 · 模型 badge · 累计 token=totalInput+totalOutput+totalCacheRead，计费口径），updated_at 倒序，无 usageSummary 灰置 + 「—」；点击展开 TurnDetailList（懒拉取）；孤儿过滤天然满足（只遍历 conversation 列表，不碰文件系统）
  - `app/settings/page.tsx`：侧栏「子会话派遣」后新增「用量」TabsTrigger + TabsContent，挂 UsageTab

### 验证结果
- `bun run lint`：0 errors / 74 warnings（= 基线）
- `bun test` 全量：118 pass / 9 fail（= Step 3 交付基线，失败集合为既有 delegation mock 污染，比对一致；本 step 未改主进程与测试）
- `bun run build:renderer`：✓（本 step 未改主进程，未跑 build:electron）
- 手动项（打开设置→用量 Tab 观察列表/展开/分段线/压缩分界）未做（计划允许跳过）；数据链路均复用既有已验证 IPC

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `TurnDetailList({ conversationId: string })`（`components/usage/TurnDetailList.tsx`，Step 5 徽章弹层可直接挂用）
  - `statusOf(entry) → { level: 'ok' | 'warn' | 'error', label: string }`——Step 5 修 UsageEntryRow 的 'end_turn' 误报应改用同一口径（error=isError||terminalReason==='error'；aborted/max_turns=warn；completed/undefined=ok）；当前在 TurnDetailList 文件内部未导出（无外部消费方），Step 5 复用时再导出
  - `buildTimeline(usage) → TimelineItem[]`（文件序 + segmented 分段标记 + compact marker 内联），同上未导出
  - UsageTab 列表行累计口径：`totalInputTokens + totalOutputTokens + totalCacheReadTokens`（不含 cacheWrite，与计划一致）
- 下个 step 该从哪里继续：Step 5 徽章弹层重构（step5-badge-popover.md）——TurnDetailList 已就绪；Popover 用 `components/ui/popover.tsx` 现成组件
- 待办或已知限制：
  - 压缩分界行需重启后新 compact 事件才有真实数据（Step 3 起 appendCompactMarker 才接入 pi 链路，存量 JSONL 无 compact 行）
  - usageEntryAdded 每轮触发 UsageTab 全列表重拉（conversations.json 小文件，开销可忽略；会话量大可改增量）
  - 列表 badge 反映 modelSelection 当前值（最近一次选择/切换），历史轮次真实模型以明细行 modelUsage 为准
  - settings-store 未加载完（DEFAULT）时模型 badge 可能短瞬显示「已删除的模型」——resolveModelLabel 对缺失 profile 的既有行为，未特殊处理
