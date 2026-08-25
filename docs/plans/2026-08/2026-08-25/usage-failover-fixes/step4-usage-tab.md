---
step: 4
title: 设置「用量」Tab
status: pending
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

- [ ] `app/settings/` 新增 `UsageTab.tsx`：侧栏注册新项「用量」
- [ ] 会话列表行：标题 · 最后活动时间 · 模型 badge（从 modelSelection/usageSummary 可得模型名的去重集合，若 usageSummary 无模型字段则用 conversation.modelSelection）· 累计 token（totalInput+totalOutput+totalCacheRead）；按最后活动时间倒序；无 usageSummary 的会话（0 轮）显示「—」或灰置
- [ ] 孤儿过滤：usage JSONL 对应已删除会话时不展示（以 conversation 列表为准遍历，不遍历文件系统）
- [ ] 新组件 `components/usage/TurnDetailList.tsx`（props：conversationId，内部经 getUsage IPC 拉取）：
  - 每轮一行：时间 · 模型（modelUsage 多桶时分行或并列 badge）· input↑ / output↓ · cacheRead / cacheWrite · 命中率（cacheRead/(input+cacheRead)）· 工具调用数（toolActivity.totalCalls）
  - 点击行展开：工具明细（各工具调用次数 + Read 文件列表）· numTurns（LLM 调用次数）· terminalReason 状态（completed=正常绿 / aborted/max_turns=黄 / error=红——修正旧 UsageEntryRow 的 'end_turn' 遗留判定）
  - 分段线：turnIndex 回跳（entry[i].turnIndex <= entry[i-1].turnIndex）或时间差 >30 分钟处画分隔线标注「会话重启/切换」
  - compact marker（Step 3 落盘的 compact 行）渲染为压缩分界行
- [ ] 排序直接按 JSONL 文件序（时间序），不依赖 turnIndex 排序键（规避历史数据回绕的排序错乱）

## 验证

- 手动：打开设置 → 用量 Tab，确认列表、展开明细、分段线、压缩分界（若有历史 compact）显示正常
- lint / 既有测试 / build:renderer

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
