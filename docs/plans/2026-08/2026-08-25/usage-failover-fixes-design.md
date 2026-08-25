# Usage 显示改造 + failover 修复设计

**日期**：2026-08-25
**来源**：两份调查报告（共享区 `failover-investigation.md`、`usage-correctness-and-display.md`），本文档只保留结论与方案，实施时细节以报告为参考。

## 背景

一次费率 failover（glm-5.3 → gpt-5.6-terra）暴露三类问题：① 切换后渲染卡死（前端按 sessionId 过滤流式事件，failover 换 sessionId 后无重连触发）；② 切换提示体验差（续跑提示持久化为普通 user 消息、amber 横幅不可关、失败 Alert 先于切换出现）；③ token 统计异常（turnIndex 归零重复、0% 快照、百分比跳变）。调查中又发现正常场景的 6 个显示/口径问题（正常轮误报警告、lastContextSize 虚高 9.5 倍、turnIndex 重启也归零、CompactMarker 断链、API 用时死显示、ContextBreakdown 死代码）。

## 目标

1. failover 后前端无缝续接（渲染重连 + 提示改造）
2. 修正常场景全部显示/口径 bug
3. 新增设置「用量」Tab：按会话汇总 token，展开逐轮明细
4. 徽章弹层改点击触发，内容轻量化（当前轮概览）
5. 不做费用显示（单价链路维持现状）

## 方案

### A. failover 渲染重连（症状 B 根因）

**核心**：让前端在收到 `failoverNotice` 时重连新 session，复用「用户手动切模型」的既有重连路径。

- `conversation-store.ts:866-872` 的 failoverNotice 监听器：在 pushFailoverNotice 之外，同时 bump `sessionRestartTrigger`（与 `useSendMessage.ts:405` 手动切模型同一机制），触发 `useAgentSession.ts:177` 的 attach effect 重跑 → `attachConversation` 经 conversationSessionMap 拿到 failover 建的新 session + live snapshot + 新 attachmentId
- 重连后 `useAgentSession` 持有新 attachmentId，旧 attachment 已被 failover 的 detach 释放 → 附带修复 refCount 泄漏（model-failover.ts:102 forced detach 后无人持有新 attachment 的泄漏）
- sessionId 更新后发送消息自然走新 session → 附带修复「冻结 UI 发消息报会话不存在」

**附带修复：模型选择器显示旧模型**。`conversationService.updateModelSelection`（conversation-service.ts:514-525）只写盘不广播；failover 切换后（model-failover.ts:96 调用处之后）补发 `conversationListChanged` 广播，前端刷新会话列表里的 modelSelection。

### B. failover 提示改造（症状 C）

1. **续跑提示消息**：`buildFailoverContinuePrompt`（model-failover.ts:27-29）的文本经 sendMessage 持久化为普通 user 消息，前端与用户手打消息同款渲染。改为特殊渲染：
   - 首选：给该消息附加可识别标记（pi harness appendMessage 若支持 metadata/自定义字段，实施时验证 pi-session.ts:644-660 的消息落盘链路）
   - 备选：消息文本加固定前缀哨兵（如 `[system:failover-continue]`），前端 ContentBlockItem 识别后渲染为系统提示条样式（类似 compact boundary），并剥掉哨兵
2. **amber 横幅**（AgentChat.tsx:507-518）：改为单条（新切换覆盖旧的）、可关闭、1 分钟自动过期
3. **失败噪音前置**：quota 类错误且 failover 设置开启时，complete(failed) 的系统通知（tipc/agent.ts:66-103）与红色 Alert（ContentBlockItem.tsx:334-360）都不展示——failoverNotice 横幅本身就是告知。链已耗尽时（maybeFailoverMainSession 返回 false）保留原有报错渲染

### C. usage 计算/落盘修复

| 问题 | 修复 | 位置 |
|---|---|---|
| 正常轮误报 amber 警告 | statusInfo 判定改为映射 pi 的 terminalReason（completed/aborted/max_turns/error），'end_turn' 遗留值删除 | UsageEntryRow.tsx:15-20 |
| lastContextSize 虚高 9.5 倍 | 改用本轮最后一条 CTX 快照的 totalTokens（无快照时回退现值） | conversation-service.ts:693-700（applyUsageSummary） |
| turnIndex 归零重复（重启+failover 都触发） | PiSession 初始化时读该会话 usage JSONL 尾行，turnIndex 续号 | pi-session.ts:254（或 pi-session-manager attach 时传入） |
| quota 失败落 0% 快照 | errorMessage 非空的消息不生成 CTX 快照 | pi-session.ts:629-637 |
| API 用时死显示 | 删「API 用时 0.0s」行（pi 侧无数据源，durationMs 恒 0） | UsageSummaryHeader.tsx |
| ContextBreakdown 死代码 | 删除组件及调用（categories 恒空） | UsageContextBreakdown.tsx |
| CompactMarker 断链 | pi 自动压缩时（pi-session.ts:898-925 compact_boundary 处）补调 `appendCompactMarker`：preTokens 用当前 lastContextTokens，postTokens 留空待下一轮 CTX 回填（或压缩摘要消息自带 tokens 字段，实施时验证） | pi-session.ts、usage-service.ts:93 |

### D. 设置「用量」Tab

设置 overlay 侧栏新增「用量」Tab（与「人设」「派遣」平级）：

- **会话列表**：每行 = 标题 · 最后活动时间 · 模型 badge（去重）· 累计 token（input+output+cacheRead 求和，计费口径）。按最后活动时间倒序
- **数据源**：列表数据用 conversations.json 的 usageSummary（totalInput/Output/CacheReadTokens 已有且口径正确，随会话列表 IPC 现成传输）；展开某会话时才经 getUsage IPC 读该会话 JSONL 逐轮明细
- **孤儿过滤**：usage JSONL 可能对应已删除会话，以 conversation 存在为准；无对应会话的文件不展示
- **逐轮明细组件**（TurnDetailList，与徽章弹层共用）：每轮一行 = 时间 · 模型 · input↑ / output↓ · cacheRead / cacheWrite · 命中率 · 工具调用数；点击行展开工具明细（调用次数 + Read 文件列表 + numTurns=LLM 调用次数）
- **分段线**：turnIndex 回跳或时间戳大间隔（>30min）处画「重启/切换」分隔线，规避排序错乱观感（turnIndex 续号修复后此为兜底展示）

### E. 徽章弹层改造（UsageBadge → 点击 Popover）

- **交互**：HoverCard 换 Popover，点击开、点外关（shadcn/ui 现成组件）
- **内容**（轻量，当前轮视角）：
  - 当前轮概览大字：模型 · input · output · cacheRead · cacheWrite · 命中率
  - 「当前轮」= 最后一条 entry（流式中本轮未落盘，显示最后已完成轮 + 流式中的 latestContext 占用）
  - 底部小字：会话累计（totals 四项）
- 逐轮列表不进弹层（归设置 Tab），弹层保持一眼可读
- 现有 Hover 卡板块去留：ByTool / ReadActivity / PermissionWaits / ByModel 保留进弹层折叠区或砍掉——**默认砍掉 ReadActivity 与 PermissionWaits（依赖 CompactMarker/低频数据），保留 ByTool**，ByModel 并入当前轮概览（单模型直接显示，多模型分行）

### F. 工具 token

API 不提供按工具的 usage 拆分，估算误差大（±20%），**不做估算**。工具信息以调用次数 + Read 文件列表呈现（toolActivity 现有数据）。

## 模块边界

**主进程**：
- `electron/main/agents/model-failover.ts`：续跑提示标记、切换后广播 modelSelection 更新、quota 失败降噪条件
- `electron/main/tipc/agent.ts`：complete(failed) 系统通知的 quota 降噪
- `electron/main/agents/pi-session/pi-session.ts`：turnIndex 续号、失败消息跳过 CTX 快照、compact marker 落盘
- `electron/main/services/conversation-service.ts`：applyUsageSummary 的 lastContextSize 口径
- `electron/main/services/usage/usage-service.ts`：appendCompactMarker 接入（已有函数）

**前端**：
- `stores/conversation-store.ts`：failoverNotice 处理（bump sessionRestartTrigger）、横幅单条化
- `components/agent-chat/hooks/useAgentSession.ts`：无需改（重连机制复用）
- `components/agent-chat/UsageBadge.tsx` + `ChatInputArea.tsx:398`：Popover 化 + 内容重组
- usage hover 卡组件族（UsageSummaryHeader / UsageByTool / UsageEntryList / UsageEntryRow / usage-utils.ts）：重构为 TurnDetailList + 弹层内容，删除 UsageContextBreakdown / UsageReadActivity / UsagePermissionWaits（若砍）
- `app/settings/`：新增「用量」Tab 页面
- `ContentBlockItem.tsx`：failover 续跑消息特殊渲染、quota 失败 Alert 降噪

## 数据流

- 流式续接：main `failoverNotice` → renderer store bump sessionRestartTrigger → attach effect → attachConversation 返回新 session snapshot → liveTail 接新 sessionId 事件流
- 用量 Tab：conversations.json usageSummary（列表）→ 点击展开 → getUsage IPC → usage JSONL → TurnDetailList
- 徽章弹层：usageEntryAdded 事件 → refetch → 最后一条 entry + latestContext

## 错误处理 / 边界

- failoverNotice 与用户手动切模型的 sessionRestartTrigger 并发：settling 机制已在主进程防重入；前端 bump 幂等（attach effect 依赖变化重跑即可）
- usage JSONL 尾行读取失败（文件损坏/空文件）：turnIndex 回退 0 起步，不阻塞会话
- 流式中收到 failoverNotice：attach effect 重跑会打断当前 liveTail 订阅重建，时序上旧 session 已销毁，无数据丢失
- quota 降噪与 failover 链耗尽的边界：maybeFailoverMainSession 返回 false 时必须保留原报错链路（系统通知 + Alert）

## 未决问题（实施时验证）

1. pi harness appendMessage 是否支持消息 metadata（决定续跑提示特殊渲染走首选还是哨兵方案）
2. compact_boundary 处能否拿到压缩后 tokens（决定 postTokens 落盘时机）
3. 多模型同轮（模型混用）时徽章「当前轮概览」的模型行展示（当前 data 支持多桶，UI 按桶分行即可，实施时看实际效果）
4. usageSummary 会随会话列表传输，量大会话（长列表）是否有性能问题（目前前端零消费无感知，接入后观察）

## 明确不做

- 费用显示（单价硬编码 0 维持现状）
- 工具 token 估算
- 上下文占用趋势曲线（数据链路已通，后续可加）
- 续跑轮全量重发上下文（供应商间缓存不互通，机制固有）
