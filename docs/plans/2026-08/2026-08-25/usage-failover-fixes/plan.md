# Usage 显示改造 + failover 修复 实施计划

**目标**：修复 failover 切换模型后的渲染断连与提示体验，修正常规 usage 显示/口径 bug，新增设置「用量」Tab 与点击式徽章弹层。

**架构思路**：failover 重连复用「用户手动切模型」的 sessionRestartTrigger 既有机制，不新造重连通道；usage 数据链路（pi-ai → usage-extractor → usage JSONL → getUsage IPC）保持不变，只修落盘口径并重做前端消费层；设置 Tab 与徽章弹层共用同一 JSONL 数据源。设计全文见 `../usage-failover-fixes-design.md`。

**涉及模块**：`electron/main/agents/model-failover.ts`、`electron/main/agents/pi-session/pi-session.ts`、`electron/main/services/conversation-service.ts`、`electron/main/services/usage/usage-service.ts`、`electron/main/tipc/agent.ts`、`stores/conversation-store.ts`、`components/agent-chat/UsageBadge.tsx`、usage 卡片组件族、`app/settings/` 新 Tab。

## 步骤索引

- [x] [Step 1: failover 渲染重连](./step1-failover-reconnect.md) — failoverNotice 触发前端重连新 session，附带修模型选择器刷新
- [x] [Step 2: failover 提示改造](./step2-failover-notice.md) — 续跑提示消息特殊渲染、横幅单条可关、quota 失败降噪
- [x] [Step 3: usage 落盘修复](./step3-usage-pipeline.md) — turnIndex 续号、跳过 0% 快照、CompactMarker 落盘、lastContextSize 口径
- [x] [Step 4: 设置「用量」Tab](./step4-usage-tab.md) — 按会话汇总列表 + 逐轮明细组件（TurnDetailList）
- [x] [Step 5: 徽章弹层重构](./step5-badge-popover.md) — hover 改点击、当前轮概览、删死组件与误报

## 全局决策

- **背景资料**：两份调查报告在会话组共享区：`failover-investigation.md`（failover 三症状根因）、`usage-correctness-and-display.md`（口径核对与显示位清单）。实施各 step 前按需读取对应章节，本文档已提炼关键结论。
- **不做**：费用显示、工具 token 估算、上下文趋势曲线、续跑轮全量重发优化。
- **验证基线**（每个 step 完成）：`bun run lint` 0 errors（既有 74 条 warning 可容忍）、既有测试全过、涉及前端跑 `bun run build:renderer`、涉及主进程跑 `bun run build:electron` 并注明需重启生效。
- **不写注释**，除非 WHY 非显而易见；不留 TODO/stub。
- **组件命名**：逐轮明细组件 `TurnDetailList`（`components/usage/`），设置新 Tab `UsageTab`（`app/settings/`）。
- **Popover** 用 shadcn/ui 现成组件，不引入新依赖。
- 主进程广播类改动参照 `conversationListChanged` 在 delegation-bridge 里的既有发送方式。
- 每个 step 一个 commit，message 格式 `feat/fix: <描述>`。

## 完成总结

五个 step 全部完成（2026-08-26）：

1. **failover 渲染重连**（c2feb44）：failoverNotice 到达即 bump sessionRestartTrigger 复用手动切模型重连通道，流式无缝续接；updateModelSelection 后广播 conversationListChanged 刷新模型选择器。
2. **failover 提示改造**（4c00b86）：续跑提示哨兵 `[system:failover-continue]` 渲染为系统提示条；横幅同会话单条可关 60s 过期；quota 失败系统通知延后由接管结果决定、红色 Alert 降级一行摘要；链耗尽保留完整报错。
3. **usage 落盘修复**（be0b2b9）：turnIndex 从 JSONL 尾部续号不再归零；失败轮跳过 0% 假快照；CompactMarker 经 usageCompact 事件落盘；entry.lastContextTokens 修正 lastContextSize 口径；修复 usage-service 既有失败 fixture。
4. **设置「用量」Tab**（5cfdb2c）：UsageTab 按会话汇总 + TurnDetailList 逐轮明细（token/缓存/命中率/工具/轮末上下文，含重启分段线与压缩分界行）。
5. **徽章弹层重构**（本 commit）：HoverCard → 点击 Popover，当前轮 modelUsage 逐桶概览为体 + 流式中提示 + 底部会话累计；删 7 个死组件与 4 个孤儿聚合函数。

**遗留**：bun test 全量 9 个 delegation mock 污染失败为仓库既有债（建议另立 step 修 delegation-test-mocks）；Alert 先红后降级 1-3s 闪现；存量数据不迁移；实机手动回归（quota failover 链切换、重启后 turnIndex、用量 Tab 观感、徽章弹层交互）待补。
