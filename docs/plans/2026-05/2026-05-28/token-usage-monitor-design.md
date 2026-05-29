# Token 用量与上下文监控设计

> 日期：2026-05-28
> 范围：会话级 token / 上下文 / 工具使用统计，输入框徽章 + HoverCard 详情。

## 1. 目标与非目标

### 目标
- 用户在对话过程中能随时看到**当前上下文占用比例**（输入框徽章），安静不晃眼
- 鼠标 hover 能看到本对话**详细的用量明细**（每一笔 turn 的 token、缓存命中、工具调用、压缩事件）
- 跨供应商通用：Claude / GLM 等都从 SDK 的 result 消息提取
- 设置项 `enable1MContext` 自然关联到进度条上限

### 非目标（YAGNI）
- ❌ 不做跨对话/全局看板（今日累计、本周等）
- ❌ 不显示金额（单价随供应商变化，没有可靠参考）
- ❌ 不做预算告警/硬上限（SDK 已有 `maxBudgetUsd`，需要时单独提）
- ❌ 不做导出 / 图表
- ❌ 不在每条 assistant 消息边上挂统计标记
- ❌ 不判断模型是否支持 1M（设置勾选就显示）

---

## 2. SDK 提供的现成数据

`SDKResultMessage`（每次 query 结束都会发一条）已经把核心字段都带齐：

| 字段 | 用途 |
|---|---|
| `usage.input_tokens` | 本次请求未命中缓存的新输入 |
| `usage.cache_read_input_tokens` | 本次命中缓存的输入 |
| `usage.cache_creation_input_tokens` | 本次新写入缓存的输入 |
| `usage.cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` | 5m / 1h 缓存细分 |
| `usage.output_tokens` | 输出 |
| `usage.server_tool_use.{web_search_requests,web_fetch_requests}` | WebSearch/WebFetch 次数 |
| `usage.service_tier`, `usage.speed` | 服务等级 |
| `total_cost_usd` | SDK 估算成本（GLM 等可能为 0，存但不显示） |
| `modelUsage[modelName]` | 按模型聚合（subagent 用不同模型时自动拆开），含 `contextWindow` 上限 |
| `duration_ms`, `duration_api_ms`, `ttft_ms`, `num_turns` | 时序信息 |
| `terminal_reason`, `is_error`, `api_error_status`, `stop_reason` | 结果状态 |
| `permission_denials` | 用户拒绝的工具 |

`SDKCompactBoundaryMessage`：
```ts
{ type: "system", subtype: "compact_boundary",
  compact_metadata: { trigger: "manual" | "auto", pre_tokens: number } }
```
压缩前 token 数，用于在明细列表标注"此处发生过压缩"。

`Agent` 工具返回 `AgentOutput`：单次 subagent 调用的 `totalToolUseCount`、`totalDurationMs`、`totalTokens`、`usage` 全部带齐，不用自己算。

---

## 3. 自己算的部分

### 3.1 当前已用上下文
```
currentContextSize = result.usage.input_tokens
                   + result.usage.cache_read_input_tokens
                   + result.usage.cache_creation_input_tokens
```
来源是 Anthropic API 语义：每次请求的"input 三件套"之和 = 本次实际送进模型的 token 总数（含 system prompt、所有历史 messages、tools 定义）。

**压缩后自动回落**：压缩后下一次 result 的 input_tokens 自然变小，进度条无需特殊处理。监听 `compact_boundary` 仅用于在明细列表插一行 marker。

### 3.2 工具调用次数聚合
扫本轮 assistant 消息的 `tool_use` 块，按 `name` 分组计数。`Agent` 工具的次数单独放 `subagentCalls`（因为里面带 token 信息）。

### 3.3 上下文上限解析

```ts
function resolveContextLimit(
  modelUsage: ModelUsage,
  settings: AppSettings
): { limit: number; label: string } {
  if (settings.activeProfile.enable1MContext) {
    return { limit: 900_000, label: '1M' };
  }
  return { limit: modelUsage.contextWindow, label: formatLabel(modelUsage.contextWindow) };
}
```

`enable1MContext` 字段已存在于 `types/settings.ts:23`，`query-based-session.ts:278` 已经在 SDK 侧把 `autoCompactWindow` 设到 900K。监控端只需读 settings store 同步进度条上限。

GLM 等供应商若不返回 `contextWindow`，用一张内置表 `MODEL_CONTEXT_WINDOWS` 兜底（常见模型写死），查不到则只显示绝对值不画进度条。

---

## 4. 数据模型

`types/usage.ts`（新增）：

```ts
export interface ConversationUsageEntry {
  // 标识
  uuid: string;                       // result 消息的 uuid
  turnIndex: number;                  // 第几轮，从 1
  parentUuid?: string;                // 触发本轮的 user message uuid
  timestamp: number;                  // ms

  // 时序
  durationMs: number;
  durationApiMs: number;
  ttftMs?: number;
  numTurns: number;                   // SDK 内部子轮次

  // 结果
  terminalReason?: string;
  stopReason?: string | null;
  isError: boolean;
  apiErrorStatus?: number;

  // 成本（存但 UI 不显示）
  totalCostUsd: number;

  // 完整 usage（原样保留，便于将来 UI 扩展）
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    cacheCreation?: {
      ephemeral5mInputTokens: number;
      ephemeral1hInputTokens: number;
    };
    serviceTier?: 'standard' | 'priority' | 'batch';
    speed?: 'standard' | 'fast';
    serverToolUse?: {
      webSearchRequests: number;
      webFetchRequests: number;
    };
  };

  // 按模型拆分（subagent 用不同模型时多 key）
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
    costUSD: number;
    contextWindow: number;
    maxOutputTokens: number;
  }>;

  // 自己聚合
  toolCalls: Array<{ name: string; count: number }>;
  subagentCalls?: Array<{
    agentId: string;
    totalTokens: number;
    totalToolUseCount: number;
    totalDurationMs: number;
    usage: ConversationUsageEntry['usage'];
  }>;
  permissionDenials?: SDKPermissionDenial[];
}

export interface CompactMarker {
  uuid: string;
  timestamp: number;
  afterTurnIndex: number;             // 在第几轮之后发生
  trigger: 'manual' | 'auto';
  preTokens: number;
}

export interface ConversationUsage {
  entries: ConversationUsageEntry[];
  compactMarkers: CompactMarker[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    totalCostUsd: number;
    turnCount: number;
    toolCallCount: number;
  };
}
```

`Conversation` 类型新增字段（`types/electron-api.ts`）：
```ts
usageSummary?: {
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  // 最近一笔的上下文占用，列表展示用
  lastContextSize?: number;
  lastContextWindow?: number;
};
```

---

## 5. 存储

### 5.1 文件布局
```
.dogear/
  conversations.json            # 加 usageSummary 字段
  usage/
    {conversationId}.jsonl      # 每行一个 ConversationUsageEntry
                                # compact marker 也作为一行（type 字段区分）
```

JSONL 行格式：
```json
{ "kind": "entry", ...ConversationUsageEntry }
{ "kind": "compact", ...CompactMarker }
```
按 timestamp 顺序追加。读取时按 kind 分流。

### 5.2 写入流程

入口在 `electron/main/agents/query-based-session.ts` 现有 result 处理位置（约 line 815）：

1. 收到 `message.type === 'result'`：
   - 提取 usage / modelUsage / 时序字段
   - 从最近一组 assistant 消息聚合 `toolCalls` 和 `subagentCalls`
   - 调 `usage-service.appendEntry(conversationId, entry)`（fire-and-forget）
   - 增量更新 `conversations.json` 的 `usageSummary`
2. 收到 `message.type === 'system' && subtype === 'compact_boundary'`：
   - 调 `usage-service.appendCompactMarker(conversationId, marker)`

写入失败：`logger.warn` 但不抛，对话主流程不受影响。

### 5.3 摘要修复
启动时（或首次打开对话时），若 `usageSummary.turnCount !== jsonl entry 行数`，触发懒重算。避免写入失败导致摘要漂移。

### 5.4 联动清理

| 触发点 | 现有位置 | 加的动作 |
|---|---|---|
| 删除单个对话 | `conversation-service.ts` 删除流程 | `unlink .dogear/usage/{id}.jsonl`（不存在则忽略） |
| 删除工作区 | 工作区管理删除流程 | 遍历被删对话 id 批量清理 |
| 分叉（fork） | `query-based-session` fork 路径 | 新对话从 0 开始，不复制 usage |
| 复用 session | `conversation-runtime-service` | 不需要动 |

孤儿恢复：若 usage jsonl 在但 conversation 索引丢了，恢复对话时自动接回。

---

## 6. 模块划分

### 6.1 主进程
```
electron/main/services/
  usage-service.ts              # appendEntry / appendCompactMarker / readUsage / deleteUsage
                                # 内部 mutex 保证并发安全

electron/main/tipc/
  usage.ts                      # getUsage(conversationId) -> ConversationUsage
                                # main->renderer event: usageEntryAdded

electron/main/agents/
  query-based-session.ts        # result / compact_boundary 处理处接入 usage-service
```

### 6.2 渲染层
```
components/agent-chat/
  usage-badge/
    UsageBadge.tsx              # 工具栏徽章：进度条 + 数字
    UsageHoverCard.tsx          # 主 popover 容器
    UsageSummaryHeader.tsx      # 头部：上下文进度 + 累计 token
    UsageByModel.tsx            # 模型分组列表
    UsageByTool.tsx             # 工具调用 Top N
    UsageEntryList.tsx          # 明细列表 + 压缩 marker 行
    UsageEntryRow.tsx           # 单条明细，可二级展开
    usage-utils.ts              # resolveContextLimit / 派生计算
                                # formatTokens / 缓存命中率

lib/hooks/
  useConversationUsage.ts       # 拉 usage + 订阅 usageEntryAdded 事件
                                # 同时订阅 settings-store 拿 enable1MContext

types/
  usage.ts                      # 数据模型
```

---

## 7. UI 设计

### 7.1 入口徽章（ChatInputArea 工具栏）

```
[▓░░░░░░░░░  15.6k / 200k]
```

- 进度条 + 文字组合，跟附件/发送按钮同一行
- 颜色阈值：<60% muted、60–85% amber、>85% red
- 压缩后数字自然回落（隐式反馈，不闪烁）
- 1M 模式：上限改成 900k，文字显示 "/ 900k" + 小角标 `1M`
- 多模型对话（subagent）按主线模型 contextWindow 算
- contextWindow 缺失时只显示绝对值，不画进度条

### 7.2 HoverCard 内容（约 560px 宽）

```
┌──────────────────────────────────────────────────────────────┐
│ 上下文                15,632 / 200,000  (8%)                 │
│   上次输入  4,210      缓存命中 11,420 (87%)                 │
│                                                              │
│ 累计 18 轮 · API 用时 45.2s · 首 token 平均 1.1s             │
│   Input total       12,432         Cache reads    98,210     │
│   Output total       3,287         Cache writes    8,120     │
├──────────────────────────────────────────────────────────────┤
│ 按模型                          按工具调用                    │
│ claude-opus-4-7   16 轮         Read    42 ×                │
│ claude-sonnet-4-6  2 轮         Grep    18 ×                │
│                                 Edit    12 ×                │
│                                 Bash     7 ×                │
│                                 （+5 个，展开）              │
├──────────────────────────────────────────────────────────────┤
│ 最近明细                              [全部 18 条 ▾]         │
│ #18  10:32  ✅       1,240↑ 312↓  92% cache  Read×3 Edit×1  │
│ #17  10:30  ⚠max_turns  3,210↑ 891↓  78% cache               │
│ ↻ 此处发生自动压缩 (152k → 8.4k)                            │
│ #16  10:28  ✅          820↑ 124↓  95% cache                 │
└──────────────────────────────────────────────────────────────┘
```

行为细节：
- Radix `HoverCard`，`openDelay` 300ms，click 可固定
- 头部最显眼的是"上下文进度"，金额完全不显示
- 按模型行：显示轮数（不显示金额）
- 按工具：Top 5 + 折叠展开
- 明细：默认 5 条 + "全部" 滚动列表
- 单条明细 hover 二级 popover 展示更细字段（5m/1h 缓存细分、subagent 列表、permission_denials）
- compact marker 作为明细中的特殊行，带 `↻` 图标，显示 "pre_tokens → 压缩后估算"

### 7.3 数据流

```
SDK result event
  -> query-based-session 提取
  -> usage-service.appendEntry
  -> conversations.json.usageSummary 增量更新
  -> tipc renderer event: usageEntryAdded
  -> useConversationUsage hook 增量并合到内存 state
  -> UsageBadge + UsageHoverCard 响应式刷新
```

---

## 8. 跨供应商兼容

| 场景 | 处理 |
|---|---|
| GLM 不返回 `total_cost_usd` | 存为 0，UI 不显示金额（本来就不显示） |
| GLM 不返回 `modelUsage` | 主进程兜底用 `{ [model]: synthesizedFromUsage }` 合成一份 |
| GLM 不返回 `contextWindow` | 内置静态表兜底；查不到只显示绝对值不画进度条 |
| `usage.cache_creation` 缺失 | 5m/1h 细分不显示，命中率仍可算 |
| `terminal_reason` 缺失 | 用 `subtype + is_error` 兜底（沿用现有逻辑） |

---

## 9. 实施步骤大纲

1. **数据层**：`types/usage.ts` 定义 + `usage-service.ts` 写读删 + IPC 路由
2. **采集层**：`query-based-session.ts` 在 result / compact_boundary 处接入；assistant 消息工具次数聚合
3. **联动清理**：conversation 删除 / 工作区删除处加 unlink
4. **summary**：`conversations.json` 加字段 + 懒重算逻辑
5. **渲染层**：徽章 + HoverCard 各子组件
6. **hook + store 桥接**：`useConversationUsage` + settings-store 订阅
7. **跨供应商兜底**：MODEL_CONTEXT_WINDOWS 内置表 + modelUsage 合成
8. **手测**：默认模式 / 1M 模式 / 多模型（含 subagent）/ 压缩边界 / GLM 切换

每步独立可验证，不强制顺序绑定。

---

## 10. 风险与未决

- **多模型 contextWindow 选哪个**：默认取"最近一次 result 的主线模型"。如果 subagent 多于主线，可能不直观，但实际很少出现，先这样。
- **设置切换 1M 后的滞后**：`enable1MContext` 改了之后当前进行中的 query 仍按旧上限发送；下一次 result 到达才能反映出新限制。这是 SDK 行为，UI 侧无法纠正。可以在设置切换时短暂提示"下一轮生效"。该提示不在本次范围。
- **jsonl 文件无限增长**：单对话很少超过 200 轮，每行约 1–2KB，量级可控。如未来需要可以加按对话归档策略，目前不做。
