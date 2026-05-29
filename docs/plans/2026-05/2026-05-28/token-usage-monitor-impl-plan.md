# Token 用量与上下文监控 实施计划

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（本会话内逐任务派发子代理 + 审查）执行本计划。
> 设计文档：`docs/plans/2026-05/2026-05-28/token-usage-monitor-design.md`（数据模型完整定义见设计文档第 4 节，本计划不重复抄写，只给增量与校正）。

**Goal:** 在聊天输入框加一个上下文占用进度条徽章 + hover 详情卡，展示本对话每一轮的 token / 缓存命中 / 工具调用 / 压缩事件，数据从 SDK result 消息提取，跨供应商通用。

**Architecture:** 主进程在 `query-based-session` 收到 `result` / `compact_boundary` 时提取用量，经管理器解析 conversationId 后写入 `.dogear/usage/{id}.jsonl`（fire-and-forget），并增量更新 `conversations.json` 的 `usageSummary`，再广播 `usageEntryAdded` 事件到渲染层。渲染层 `useConversationUsage` hook 首屏拉全量 + 订阅增量，`UsageBadge`/`UsageHoverCard` 响应式渲染。

**Tech Stack:** Electron 主进程（TS, ES2020）、@egoist/tipc、@anthropic-ai/claude-agent-sdk、React 19 + Zustand + Tailwind 4 + radix-ui、Bun（含内置 `bun test`）。

**验证基线（本项目无 vitest/jest）：**
- 纯函数任务：`bun test <file>`（Bun 内置，无需加依赖）走红/绿循环。
- 主进程集成/IPC：`bun run build:electron`（tsc 类型检查）+ `bun run lint`。
- 渲染层/UI：`bun run build:renderer` + `bun run lint` + 设计文档第 8 节手测矩阵。
- 提交粒度：每个 Task 结束提交一次。提交命令统一用 `rtk git ...`（见项目 CLAUDE.md RTK 约定）。

**与设计文档的校正（已核对当前代码，务必遵守）：**
1. `HoverCard` / `Progress` 组件项目里**都不存在**。HoverCard 用已在 `package.json` 的 `radix-ui` ^1.4.3 包封装（`import { HoverCard } from "radix-ui"`）；进度条用纯 Tailwind `<div>`，不新增依赖。
2. usage jsonl 的**删除清理放在 tipc 层**（`electron/main/tipc/conversations.ts` 的删除 RPC，与现有 SDK session 清理同层），**不**放 `conversation-service.ts`（该 service 注释明确只删索引，行 375-378）。
3. `usageSummary` 字段同时加到：存储索引 `ConversationIndex`（`conversation-service.ts:19-33`）+ 前端类型 `Conversation`（`types/electron-api.ts`）。
4. settings 取值无 `activeProfile` 计算属性，路径为 `settings.profiles[settings.ai.activeProfileId]?.enable1MContext`。`enable1MContext` 定义在 `types/settings.ts` 的 `ModelProfile`（行 23）。
5. `conversationId` 需通过 `QueryBasedSessionConfig` 显式串入采集层（不依赖 `getConversationIdBySession` 的绑定时机）。
6. JSONL 追加用 `safe-json.ts` 的 `withFileLock` 包裹 `fs.appendFile` 保证并发安全。`getConfigDir()` 按现有约定在文件内联一份。

---

## Phase A — 数据层

### Task 1: 数据模型 `types/usage.ts`

**Files:**
- Create: `types/usage.ts`

**Step 1: 落地类型定义**

照搬设计文档第 4 节的 `ConversationUsageEntry` / `CompactMarker` / `ConversationUsage` 三个接口到 `types/usage.ts`。`SDKPermissionDenial` 用 `import type { SDKPermissionDenial } from '@anthropic-ai/claude-agent-sdk'`（若导出名不符，退化为 `permissionDenials?: Array<{ tool_name: string; tool_input: unknown }>`，executor 需先 grep `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 确认导出名）。

额外导出一个 JSONL 行联合类型，供 service 读写：
```ts
export type UsageJsonlLine =
  | ({ kind: 'entry' } & ConversationUsageEntry)
  | ({ kind: 'compact' } & CompactMarker);
```

**Step 2: 验证**

Run: `bun run build:renderer`（前端 tsconfig 覆盖 `types/`）
Expected: 类型编译通过，无报错。

**Step 3: Commit**

`rtk git add types/usage.ts && rtk git commit -m "feat(usage): 新增 token 用量数据模型类型"`

---

### Task 2: 用量提取纯函数 `usage-extractor.ts`（TDD）

> 主进程侧纯函数：把一条 SDK `result` 消息 + 本轮 assistant 消息快照，转成 `ConversationUsageEntry`。含 `MODEL_CONTEXT_WINDOWS` 兜底表、modelUsage 合成、工具次数聚合。无任何 IO，可单测。

**Files:**
- Create: `electron/main/services/usage/usage-extractor.ts`
- Test: `electron/main/services/usage/usage-extractor.test.ts`

**Step 1: 写失败测试**

```ts
import { test, expect } from 'bun:test';
import { extractUsageEntry, MODEL_CONTEXT_WINDOWS } from './usage-extractor.ts';

test('从 result 消息提取 usage 三件套与时序', () => {
  const result = {
    type: 'result', uuid: 'r1', subtype: 'success', is_error: false,
    duration_ms: 1000, duration_api_ms: 800, num_turns: 2, total_cost_usd: 0.01,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 10 },
    modelUsage: { 'claude-opus-4-7': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 900, cacheCreationInputTokens: 10, webSearchRequests: 0, costUSD: 0.01, contextWindow: 200000, maxOutputTokens: 64000 } },
  } as any;
  const turnMsgs = [
    { type: 'tool_use', toolName: 'Read' }, { type: 'tool_use', toolName: 'Read' }, { type: 'tool_use', toolName: 'Grep' },
  ] as any;
  const entry = extractUsageEntry(result, turnMsgs, 1);
  expect(entry.usage.inputTokens).toBe(100);
  expect(entry.usage.cacheReadInputTokens).toBe(900);
  expect(entry.turnIndex).toBe(1);
  expect(entry.toolCalls).toEqual([{ name: 'Read', count: 2 }, { name: 'Grep', count: 1 }]);
  expect(entry.totalCostUsd).toBe(0.01);
});

test('GLM 缺 modelUsage 时用 usage 合成一份', () => {
  const result = {
    type: 'result', uuid: 'r2', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as any;
  const entry = extractUsageEntry(result, [], 1, 'glm-4-plus');
  expect(Object.keys(entry.modelUsage).length).toBe(1);
  expect(entry.modelUsage['glm-4-plus'].inputTokens).toBe(10);
});

test('MODEL_CONTEXT_WINDOWS 含常见模型兜底', () => {
  expect(MODEL_CONTEXT_WINDOWS['claude-opus-4-7']).toBeGreaterThan(0);
});

test('Agent 工具调用单独拆到 subagentCalls，不混进 toolCalls', () => {
  const result = { type: 'result', uuid: 'r3', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as any;
  const turnMsgs = [
    { type: 'tool_use', toolName: 'Agent' },
    { type: 'tool_result', subAgentId: 'a1', subAgentTokens: 500, subAgentToolUseCount: 3, subAgentDurationMs: 200 },
  ] as any;
  const entry = extractUsageEntry(result, turnMsgs, 1);
  expect(entry.toolCalls.find(t => t.name === 'Agent')).toBeUndefined();
  expect(entry.subagentCalls?.[0].totalTokens).toBe(500);
});
```

**Step 2: 跑测试确认失败**

Run: `bun test electron/main/services/usage/usage-extractor.test.ts`
Expected: FAIL（模块/函数未定义）。

**Step 3: 写最小实现**

实现 `extractUsageEntry(result, turnMessages, turnIndex, fallbackModel?)`：
- 从 `result.usage` 映射到 entry.usage（snake→camel：input_tokens→inputTokens 等，含 `cache_creation.ephemeral_5m/1h`、`server_tool_use`、`service_tier`、`speed`）。
- `modelUsage` 原样保留；缺失时合成 `{ [fallbackModel ?? 'unknown']: synthesizedFromUsage }`，`contextWindow` 查 `MODEL_CONTEXT_WINDOWS`（查不到填 0）。
- `toolCalls`：扫 `turnMessages` 中 `type==='tool_use'` 的 `toolName` 分组计数，**排除** `Agent`/`Task`（用 `SUBAGENT_TOOL_NAMES` 同款判断），按 count 降序。
- `subagentCalls`：扫 `turnMessages` 中带 `subAgentId` 的 `tool_result`，映射 `{ agentId, totalTokens, totalToolUseCount, totalDurationMs }`。
- 时序/结果字段：`durationMs`/`durationApiMs`/`ttftMs`/`numTurns`/`terminalReason`/`stopReason`/`isError`/`apiErrorStatus`/`totalCostUsd`（缺省 0）/`permissionDenials`。
- `MODEL_CONTEXT_WINDOWS`：写死常见模型（claude-opus-4-7 / claude-sonnet-4-6 / claude-haiku-4-5 / 200000，glm 系列 128000/200000 等，executor 取保守值即可）。

> 注意：主进程 tsconfig 是 `module=ES2020` node 解析，import 本地文件**不要**带 `.ts` 后缀（编译产物是 `.js`）。测试里 `bun test` 可带 `.ts`，但实现源码 import 同目录文件用无扩展名或 `.js`——以本仓库现有 import 风格为准（grep 邻近 service 确认）。

**Step 4: 跑测试确认通过**

Run: `bun test electron/main/services/usage/usage-extractor.test.ts`
Expected: PASS（4 个用例全绿）。

**Step 5: Commit**

`rtk git add electron/main/services/usage/ && rtk git commit -m "feat(usage): 新增用量提取纯函数 + 单测"`

---

### Task 3: 存储服务 `usage-service.ts`

**Files:**
- Create: `electron/main/services/usage/usage-service.ts`
- Modify: 复用 `electron/main/services/safe-json.ts` 的 `withFileLock`

**Step 1: 实现**

内联 `getConfigDir()`（照 `conversation-service.ts:82`）。usage 目录 `path.join(getConfigDir(), 'usage')`，文件 `{conversationId}.jsonl`。导出：
- `appendEntry(conversationId, entry: ConversationUsageEntry): Promise<void>` — 包 `withFileLock`，确保目录存在（`fs.mkdir(dir,{recursive:true})`），`fs.appendFile(file, JSON.stringify({kind:'entry',...entry})+'\n')`。catch 后 `logger.warn` 不抛。
- `appendCompactMarker(conversationId, marker: CompactMarker): Promise<void>` — 同上，`kind:'compact'`。
- `readUsage(conversationId): Promise<ConversationUsage>` — 读文件按行 parse（参照 `stock-data-service.ts` 的 `parseJsonl`，ENOENT 返回空 `{entries:[],compactMarkers:[],totals:{...0}}`），按 `kind` 分流，计算 `totals`（汇总 input/output/cacheRead/cacheCreation/cost/turnCount/toolCallCount）。
- `deleteUsage(conversationId): Promise<void>` — `fs.unlink`，ENOENT 忽略。
- 用 `mainLogger.child('usage-service')` 日志。

**Step 2: 验证**

Run: `rtk tsc -p tsconfig.electron.json`（即 `bun run build:electron`）
Expected: 编译通过。

**Step 3: 轻量行为验证（可选 bun test）**

可写一个临时 bun test 对 `appendEntry`+`readUsage` 走真实临时目录往返一次，确认 totals 汇总正确，跑完删测试文件或保留为 `usage-service.test.ts`（保留更好）。

**Step 4: Commit**

`rtk git add electron/main/services/usage/ && rtk git commit -m "feat(usage): 新增 usage-service JSONL 读写删"`

---

### Task 4: IPC 路由 `tipc/usage.ts` + 事件定义

**Files:**
- Create: `electron/main/tipc/usage.ts`
- Modify: `electron/main/tipc/index.ts`（聚合 router）
- Modify: `electron/main/tipc/renderer-handlers.ts`（新增 `usageEntryAdded` 事件）

**Step 1: usage.ts 路由**

照 `tipc/article.ts` 风格（`const t = tipc.create()`，`t.procedure.input<>().action()`）：
```ts
export const usageRouter = {
  getUsage: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => usageService.readUsage(input.conversationId)),
};
```

**Step 2: index.ts 聚合**

`import { usageRouter } from './usage.js'`，在 `router` 对象 spread `...usageRouter`。

**Step 3: renderer-handlers.ts 事件**

在 `RendererHandlers` type 内新增（照 `articleParseStatusChanged` 先例）：
```ts
usageEntryAdded: (data: { conversationId: string }) => void;
```
> 事件 payload 只带 `conversationId` 作为"失效信号"，渲染层收到后增量 append 或重新 `getUsage`。为简单起见首版只传 conversationId，hook 收到后重新拉全量（对话很少 >200 轮，开销可接受）。

**Step 4: 验证**

Run: `bun run build:electron`
Expected: 编译通过。

**Step 5: Commit**

`rtk git add electron/main/tipc/ && rtk git commit -m "feat(usage): 新增 getUsage 路由与 usageEntryAdded 事件"`

---

## Phase B — 采集接入

### Task 5: 把 conversationId 串入会话配置

**Files:**
- Modify: `electron/main/agents/query-based-session.ts`（`QueryBasedSessionConfig` 加字段）
- Modify: `electron/main/tipc/agent.ts`（创建会话处传入 conversationId）

**Step 1: 加配置字段**

`QueryBasedSessionConfig`（约 line 94-120）新增 `conversationId?: string;`。

**Step 2: 创建会话处传值**

executor 先 grep `createSession(` / `createQueryBasedSession` 在 `electron/main/tipc/agent.ts` 与 `conversation-runtime-service.ts` 的调用点，把已知的 conversationId 透传进 config。确认所有创建路径（桌面新建/resume/fork/bot 绑定）都带上。

**Step 3: 验证**

Run: `bun run build:electron`
Expected: 编译通过。

**Step 4: Commit**

`rtk git add -A && rtk git commit -m "feat(usage): 会话配置串入 conversationId 供用量采集"`

---

### Task 6: 采集接入 query-based-session + manager 持久化广播

**Files:**
- Modify: `electron/main/agents/query-based-session.ts`（result / compact_boundary 处发事件）
- Modify: `electron/main/agents/query-based-session.ts`（`QueryBasedSessionManager.createSession` 订阅新事件）

**Step 1: session 侧发事件**

- 维护一个 `turnIndex` 计数器（session 实例字段，每次进入 `result` 处理 +1）。
- 在 `processMessageLoop` 的 `message.type === 'result'` 分支（约 line 815）**进入时**，用 `extractUsageEntry(message, this.currentTurnMessages, this.turnIndex, this.currentActiveProfile?.opusModel /*或实际模型*/)` 构造 entry，`this.emit('usage', { conversationId: this.config.conversationId, entry })`。
  > 注意取 entry 必须在 `this.currentTurnMessages = []` 清空之前。当前清空在 line 873，所以在 line 872 之前提取。
- 在 `convertSDKMessage` 的 `subtype === 'compact_boundary'` 分支（约 line 1198）**额外** `this.emit('compactMarker', { conversationId, marker })`（marker 含 trigger/preTokens/afterTurnIndex=this.turnIndex/timestamp/uuid）。该处仍返回原 `compact_boundary` 消息给前端，不影响现有渲染。

**Step 2: manager 侧订阅持久化 + 广播**

在 `QueryBasedSessionManager.createSession` 内（已有 `session.on('message'...)` 等），新增：
```ts
session.on('usage', ({ conversationId, entry }) => {
  if (!conversationId) return;
  usageService.appendEntry(conversationId, entry).catch(() => {});
  conversationService.applyUsageSummary(conversationId, entry).catch(() => {}); // Task 7 提供
  broadcastUsageEntryAdded(conversationId); // 见下
});
session.on('compactMarker', ({ conversationId, marker }) => {
  if (!conversationId) return;
  usageService.appendCompactMarker(conversationId, marker).catch(() => {});
});
```
`broadcastUsageEntryAdded`：遍历 `BrowserWindow.getAllWindows()`，对未销毁窗口 `getRendererHandlers<RendererHandlers>(win.webContents).usageEntryAdded.send({ conversationId })`（照 `article.ts` 第 35-42 行先例）。可放 manager 顶部一个小工具函数或直接复用 broadcaster 思路。

> manager 不能直接 import 渲染层类型造成循环时，把广播逻辑做成注入函数（类似已有 `setBroadcaster`），由 `agent.ts` 注册。executor 视实际依赖方向选择：优先直接 `getRendererHandlers` + `BrowserWindow`（主进程内安全）。

**Step 3: 验证**

Run: `bun run build:electron` + `bun run lint`
Expected: 编译/lint 通过。
手动：`bun run dev`，发一轮对话，看 `.dogear/usage/{id}.jsonl` 是否生成且每轮一行；触发一次 `/compact` 看是否落 compact 行。

**Step 4: Commit**

`rtk git add -A && rtk git commit -m "feat(usage): result/compact 接入用量采集并广播"`

---

## Phase C — summary + 联动清理

### Task 7: usageSummary 字段 + 增量更新 + 懒重算

**Files:**
- Modify: `electron/main/services/conversation-service.ts`（`ConversationIndex` 加 `usageSummary`；新增 `applyUsageSummary` / `recomputeUsageSummaryIfStale`）
- Modify: `types/electron-api.ts`（`Conversation` 镜像 `usageSummary`）

**Step 1: 加字段**

`ConversationIndex`（行 19-33 末尾）和前端 `Conversation` 都加（结构照设计文档第 4 节末）：
```ts
usageSummary?: {
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  lastContextSize?: number;
  lastContextWindow?: number;
};
```

**Step 2: applyUsageSummary**

`applyUsageSummary(conversationId, entry)`：定位所属 workspace（grep service 内现有"根据 conversationId 找 workspace"的方式；若需 workspaceId，从 `entry` 拿不到则遍历 workspaces 查找，或让 manager 同时把 workspaceId 传入——executor 选成本最低的：优先在 manager 调用时连 workspaceId 一起传）。累加 turnCount/totalInput/totalOutput/totalCacheRead，`lastContextSize = inputTokens+cacheRead+cacheCreation`，`lastContextWindow = 主模型 contextWindow`。整体走现有 `loadWorkspaceConversations`+`saveWorkspaceConversations`。

**Step 3: 懒重算**

`recomputeUsageSummaryIfStale(conversationId)`：读 `usageService.readUsage`，若 `usage.totals.turnCount !== index.usageSummary?.turnCount`，用 totals 重建 summary 写回。在 tipc `getUsage` 或对话首次打开时调用一次即可（executor 接到 `getUsage` handler 里顺带触发，不阻塞返回）。

**Step 4: 验证**

Run: `bun run build:electron` + `bun run build:renderer`
Expected: 双端编译通过。

**Step 5: Commit**

`rtk git add -A && rtk git commit -m "feat(usage): conversations 索引增量维护 usageSummary + 懒重算"`

---

### Task 8: 联动清理（删除对话 / 删除工作区）

**Files:**
- Modify: `electron/main/tipc/conversations.ts`（删除对话 RPC 处加 `usageService.deleteUsage`）
- Modify: 工作区删除流程（grep 定位：`tipc/workspace.ts` 或 `workspace-json-service.ts` 的删除路径）

**Step 1: 单对话删除**

在 tipc 层删除对话 RPC（与现有 SDK session 清理同处）追加 `await usageService.deleteUsage(id).catch(()=>{})`。

**Step 2: 工作区删除**

删除工作区时遍历其下对话 id，批量 `deleteUsage`。executor 先 grep 工作区删除实现位置，找到遍历对话的现成循环复用。

**Step 3: fork 不复制**

确认 fork 新对话 conversationId 不同 → 天然从 0 开始，无需改动（仅在计划中记录，无代码）。

**Step 4: 验证**

Run: `bun run build:electron`
Expected: 编译通过。
手动：删一个有 usage 的对话，确认 `.dogear/usage/{id}.jsonl` 被删。

**Step 5: Commit**

`rtk git add -A && rtk git commit -m "feat(usage): 删除对话/工作区时联动清理 usage 文件"`

---

## Phase D — 渲染层

### Task 9: HoverCard UI 封装

**Files:**
- Create: `components/ui/hover-card.tsx`

**Step 1: 确认导入可用**

executor 先确认 `import { HoverCard } from "radix-ui"` 在本项目可用（`radix-ui` ^1.4.3 已在依赖）。若该包未导出 HoverCard 命名空间，退化方案：用现有 `components/ui/popover.tsx` 包一层 hover 行为（`onMouseEnter`/`onMouseLeave` 控制 `open`，支持 click 固定）。

**Step 2: 实现**

照 shadcn `hover-card` 标准封装导出 `HoverCard` / `HoverCardTrigger` / `HoverCardContent`（用 `cn()` + 现有 popover 同款动画类名）。

**Step 3: 验证**

Run: `bun run build:renderer`
Expected: 编译通过。

**Step 4: Commit**

`rtk git add components/ui/hover-card.tsx && rtk git commit -m "feat(ui): 新增 HoverCard 封装组件"`

---

### Task 10: 渲染层派生纯函数 `usage-utils.ts`（TDD）

**Files:**
- Create: `components/agent-chat/usage-badge/usage-utils.ts`
- Test: `components/agent-chat/usage-badge/usage-utils.test.ts`

**Step 1: 写失败测试**

```ts
import { test, expect } from 'bun:test';
import { resolveContextLimit, formatTokens, cacheHitRate, currentContextSize } from './usage-utils.ts';

test('1M 模式上限 900k 且带 1M 标签', () => {
  const r = resolveContextLimit({ contextWindow: 200000 } as any, true);
  expect(r.limit).toBe(900000); expect(r.label).toBe('1M');
});
test('普通模式取 modelUsage.contextWindow', () => {
  const r = resolveContextLimit({ contextWindow: 200000 } as any, false);
  expect(r.limit).toBe(200000);
});
test('contextWindow 缺失返回 limit=0（UI 据此不画进度条）', () => {
  const r = resolveContextLimit({ contextWindow: 0 } as any, false);
  expect(r.limit).toBe(0);
});
test('formatTokens 千分位缩写', () => {
  expect(formatTokens(15632)).toBe('15.6k');
  expect(formatTokens(900000)).toBe('900k');
});
test('cacheHitRate = cacheRead / (input+cacheRead)', () => {
  expect(cacheHitRate({ inputTokens: 100, cacheReadInputTokens: 900 } as any)).toBeCloseTo(0.9);
});
test('currentContextSize = input + cacheRead + cacheCreation', () => {
  expect(currentContextSize({ inputTokens: 100, cacheReadInputTokens: 900, cacheCreationInputTokens: 10 } as any)).toBe(1010);
});
```

**Step 2: 跑测试确认失败**

Run: `bun test components/agent-chat/usage-badge/usage-utils.test.ts`
Expected: FAIL。

**Step 3: 实现**

实现上述函数 + `formatLabel(window)`（200000→'200k'，1000000→'1M'）。`resolveContextLimit(modelUsage, enable1M)`：1M→`{limit:900000,label:'1M'}`；否则 `{limit:contextWindow, label:formatLabel(contextWindow)}`；contextWindow 为 0/缺失则 `limit:0`。

**Step 4: 跑测试确认通过**

Run: `bun test components/agent-chat/usage-badge/usage-utils.test.ts`
Expected: PASS。

**Step 5: Commit**

`rtk git add components/agent-chat/usage-badge/ && rtk git commit -m "feat(usage): 渲染层用量派生纯函数 + 单测"`

---

### Task 11: `useConversationUsage` hook

**Files:**
- Create: `lib/hooks/useConversationUsage.ts`（若目录不存在则 `components/agent-chat/usage-badge/useConversationUsage.ts`，executor 按现有 hooks 放置约定选位）

**Step 1: 实现**

照 `components/agent-chat/hooks/useSessionMessages.ts` 的订阅+cleanup 模式：
- 入参 `{ conversationId: string | null }`。
- 首屏 `client.getUsage.invoke({conversationId})` 拉全量存 state。
- `rendererEvents.usageEntryAdded.listen` 收到匹配 conversationId 时重新 `getUsage`（或增量；首版重新拉）。
- 同时从 `useSettingsStore` 取 `enable1MContext`：`useSettingsStore(s => s.settings.profiles[s.settings.ai.activeProfileId]?.enable1MContext ?? false)`。
- 返回 `{ usage, enable1MContext, contextLimit }`，其中 `contextLimit = resolveContextLimit(最近一条 entry 的主模型 modelUsage, enable1MContext)`。

**Step 2: 验证**

Run: `bun run build:renderer`
Expected: 编译通过。

**Step 3: Commit**

`rtk git add -A && rtk git commit -m "feat(usage): 新增 useConversationUsage hook"`

---

### Task 12: UsageBadge + UsageHoverCard 子组件 + 接入输入框

**Files:**
- Create: `components/agent-chat/usage-badge/UsageBadge.tsx`
- Create: `components/agent-chat/usage-badge/UsageHoverCard.tsx`
- Create: `components/agent-chat/usage-badge/UsageSummaryHeader.tsx`
- Create: `components/agent-chat/usage-badge/UsageByModel.tsx`
- Create: `components/agent-chat/usage-badge/UsageByTool.tsx`
- Create: `components/agent-chat/usage-badge/UsageEntryList.tsx`
- Create: `components/agent-chat/usage-badge/UsageEntryRow.tsx`
- Modify: `components/agent-chat/ChatInputArea.tsx`（约 line 440 插入徽章）

**Step 1: UsageBadge（最小可见）**

先做徽章本体：进度条（Tailwind div，宽度 = `min(used/limit,1)*100%`）+ 文字 `formatTokens(used)/formatTokens(limit)`。颜色阈值 <60% `bg-muted-foreground`、60-85% `bg-amber-500`、>85% `bg-red-500`。`limit===0` 时只显示绝对值不画进度条。1M 模式文字带 `1M` 角标。用 `cn()`，图标 lucide（如 `Gauge`/`BarChart3`），尺寸 `text-xs`、`size={14}`，与工具栏其它按钮一致。

**Step 2: 接入 ChatInputArea**

在 `ChatInputArea.tsx` 人设按钮块与 `ml-auto` 发送块之间（约 line 440）插入 `<UsageBadge conversationId={...} />`。注意 `ChatInputArea` 当前有 `sessionId` prop，但 usage 按 conversationId 存储——executor 确认 `ChatInputArea` 能拿到 conversationId（grep 父组件 `AgentChat.tsx` 传参；若只有 sessionId，则把 conversationId 也透传下来，或在 hook 内用 sessionId→conversationId 映射 RPC）。**首选透传 conversationId**。

**Step 3: HoverCard 详情（按设计文档 7.2 布局）**

`UsageBadge` 包进 `HoverCard`（openDelay 300ms，可 click 固定），内容容器 `UsageHoverCard` 组合：
- `UsageSummaryHeader`：上下文进度大字 + 上次输入/缓存命中% + 累计轮数/API 用时/首 token；金额一律不显示。
- `UsageByModel`：按 modelUsage key 列模型 + 轮数（不显示金额）。
- `UsageByTool`：toolCalls Top 5 + 折叠展开。
- `UsageEntryList` + `UsageEntryRow`：默认 5 条，"全部 N 条"展开滚动；compact marker 作特殊行（`↻` 图标 + `preTokens → 压缩后`）；单行 hover 二级展示 5m/1h 缓存细分、subagentCalls、permissionDenials。
> 子组件保持每个 <150 行，纯展示，数据由 `useConversationUsage` 经 props 下传。

**Step 4: 验证**

Run: `bun run build:renderer` + `bun run lint`
Expected: 编译/lint 通过。
手动：`bun run dev`，发几轮对话，看徽章进度增长、hover 出明细、压缩后数字回落、压缩 marker 行出现。

**Step 5: Commit**

`rtk git add -A && rtk git commit -m "feat(usage): 用量徽章 + HoverCard 详情面板并接入输入框"`

---

## Phase E — 跨供应商兜底 + 手测收尾

### Task 13: 跨供应商核对 + 手测矩阵 + 文档同步

**Files:**
- 可能微调：`usage-extractor.ts`（GLM 兜底）、`usage-utils.ts`（limit=0 不画条）
- Modify（文档）：`.claude/rules/codebase-map.md`（登记新模块）

**Step 1: 跨供应商核对**

对照设计文档第 8 节逐项确认 extractor/utils 已覆盖：GLM 无 cost→0 不显示；无 modelUsage→合成；无 contextWindow→limit 0 不画条；无 cache_creation→5m/1h 不显示但命中率仍算。补缺。

**Step 2: 手测矩阵（设计文档第 8 节）**

`bun run dev` 逐项验证并记录：默认模式 / 1M 模式（设置勾选后下一轮上限变 900k）/ 多模型含 subagent（按模型分组出现多 key）/ 压缩边界（marker 行 + 数字回落）/ 切到 GLM profile（无金额、进度条降级行为正确）。

**Step 3: 文档同步**

调用 `/doc-sync` 或手动在 `.claude/rules/codebase-map.md` 登记：新增 `usage/` 服务模块、`tipc/usage.ts`、`types/usage.ts`、`usage-badge/` 组件群、`useConversationUsage` hook。

**Step 4: Commit**

`rtk git add -A && rtk git commit -m "feat(usage): 跨供应商兜底核对 + 文档同步"`

---

## 风险与备注（执行时留意）

- **conversationId 可得性**是采集链路成败关键（Task 5/6/12）。优先显式透传，不要依赖 `getConversationIdBySession` 的绑定时机。
- **提取时机**：必须在 `currentTurnMessages` 被清空（query-based-session line 873）**之前**取工具聚合。
- **fire-and-forget**：所有 usage 写入失败只 warn 不抛，绝不影响对话主流程。
- **bun test 后缀**：测试文件 import 可带 `.ts`；主进程实现源码 import 本地模块遵循仓库现有扩展名风格。
- 多模型 contextWindow 取"最近一次 result 主线模型"，subagent 多于主线的少见情况先不特殊处理（设计文档第 10 节已记录）。
