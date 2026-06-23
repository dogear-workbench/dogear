---
step: 2
title: Usage 数据层扩展
status: done
---

## 目标
扩展 ConversationUsageEntry 增加**工具调用元数据**（首要场景 Read 重读统计）和**权限等待时长**，为后续判断「重读是否高频 / 是否大多发生在 compact 后 / 哪些权限拦了多少时间」铺数据，不动 UI。

> 设计参考 OpenTelemetry CLI 内置的 `claude_code.tool.execution` / `claude_code.tool.blocked_on_user` 两层 span 概念，但本方案不引入 OTel collector，仅借鉴字段命名与维度抽象。

## 依赖上下文（接力棒输入）
- 当前数据结构：`types/usage.ts` 定义 ConversationUsageEntry / CompactMarker / ContextSnapshot / ConversationUsage / UsageJsonlLine（主进程镜像在 `electron/main/types.ts`）
- 当前 extractor：`electron/main/services/usage/usage-extractor.ts` 从 SDK result 提取，含 MODEL_CONTEXT_WINDOWS 兜底
- 当前存储：`electron/main/services/usage/usage-service.ts` 落 `.dogear/usage/{conversationId}.jsonl`
- 权限事件链路：`hooks/useSessionEvents.ts` 监听 permissionRequest 事件 → PermissionRequestCard 渲染 → useSendMessage 通过 IPC 回传响应
- 设计文档要求：按 file_path 聚合本会话 Read 次数；记录"距上次 Read 隔多少轮"+"中间是否有 compact 事件"

## 计划改动

### A. 工具活动字段（toolActivity）
- [ ] `types/usage.ts` 加字段（同步主进程 mirror）：
  ```ts
  /** 单个工具的本 entry 调用记录 */
  export type ToolCallRecord = {
    /** 工具名，如 'Read' / 'Edit' / 'Bash' */
    name: string;
    /** 本 entry 内该工具被调用次数 */
    count: number;
    /** Read 专属：命中的 file_path 列表（去重，按调用顺序） */
    files?: string[];
  };

  /** 工具活动聚合（结构预留扩展，未来可加 Edit/Bash 等） */
  export type ToolActivity = {
    /** 本 entry 内所有工具调用记录 */
    calls: ToolCallRecord[];
    /** 本 entry 内工具调用总数（含重复） */
    totalCalls: number;
  };

  export type ConversationUsageEntry = {
    // ...既有字段
    toolActivity?: ToolActivity; // optional 兼容旧 JSONL
    permissionWaits?: PermissionWaitRecord[]; // 见 B 小节
  };
  ```
- [ ] `usage-extractor.ts`：
  - 遍历 result.messages 中的 assistant message → content blocks → type === 'tool_use'
  - 按 `name` 聚合 ToolCallRecord，count 累加
  - Read 工具额外收集 `input.file_path` 到 files
  - 写入 entry.toolActivity
- [ ] 主进程类型镜像 `electron/main/types.ts` 同步加 ToolActivity / ToolCallRecord / PermissionWaitRecord

### B. 权限等待时长字段（permissionWaits）
- [ ] `types/usage.ts` 加：
  ```ts
  export type PermissionWaitRecord = {
    /** 权限请求对应的 tool name（如 'Bash'） */
    toolName: string;
    /** 用户决策结果：allow / deny / always_allow */
    decision: 'allow' | 'deny' | 'always_allow';
    /** 从请求发出到用户响应的等待毫秒数 */
    waitMs: number;
    /** 请求时间戳（ISO 字符串，便于跨 entry 对齐） */
    requestedAt: string;
  };
  ```
- [ ] 前端 `hooks/useSessionEvents.ts`（或 useSendMessage 中权限响应路径）：
  - 收到 `permissionRequest` 事件时记下 `requestedAt = Date.now()` + toolName
  - 用户响应（allow/deny/always_allow）时计算 `waitMs = Date.now() - requestedAt`
  - 通过新增 IPC `usage:recordPermissionWait` 上报到主进程
- [ ] 新增 IPC `usage/recordPermissionWait`（建议放 `electron/main/tipc/usage.ts`）：
  - 接收 `{ conversationId, record: PermissionWaitRecord }`
  - 写入当前 entry 的 permissionWaits 数组（如该 entry 已 finalize，追加到最近一条 entry）
- [ ] usage-service：提供 `appendPermissionWait(conversationId, record)` 方法，按 conversationId 找当前/最近 entry 写入

### 写入策略
- 现有 `appendEntry` 不动，新字段靠 JSON 序列化自动带上
- permissionWaits 是异步上报（用户响应时机不固定），需要单独的追加接口而不是 entry 完成时一次性写

## 不在本步范围
- 「重读 vs 上次 Read 间隔轮数」「中间是否有 compact」这两个跨 entry 派生指标 → 移到 Step 3 的展示层在读取时聚合（避免落库结构复杂化）
- 缓存类型分布（5m / 1h cache_creation）→ Step 3 处理，依赖 SDK 是否暴露 ttl
- UI 改动 → Step 3
- 工具耗时（duration）→ 当前 result.messages 推不出来，暂不做；若要测得引入 OTel

## 实施回填

### 实际改动
- 与计划差异：
  - **不留兼容字段**：直接替换 `toolCalls` → `toolActivity`，删旧字段（按 CLAUDE.md「开发阶段不做兼容性代码」）；旧 JSONL 行的 toolCalls 在读取时会落到 `kind, ...rest` 的 rest 里被忽略，不影响计算
  - **PermissionWaitRecord.decision 扩四种**：原计划只有 `'allow' | 'deny' | 'always_allow'`，实际加上 `'allow_session'` 与 SDK behavior 对齐（PermissionRequestCard 真实有 4 个分支）
  - **PermissionWaitRecord.requestedAt 类型改 number**：原计划是 ISO 字符串，实际用 Date.now() 毫秒数（与 entry.timestamp / block.timestamp 一致便于聚合时间窗口比较）
  - **append-only 写入方案**：原计划「写入当前 entry 的 permissionWaits 数组」但 JSONL 是 append-only 无法回写已落行；改为新增独立 JSONL 行 `kind: 'permission'`，`readUsage` 时按 requestedAt ≤ entry.timestamp 归属到所属 entry，找不到挂最后一条
  - **toolActivity 为 undefined 时不落字段**：calls 为空时 entry.toolActivity 直接 undefined（不存空对象）；UsageByTool / UsageEntryRow 用 `?.calls ?? []` 兜底
  - **Read 文件去重**：fileSet（Set）追加期间去重，按调用顺序保留首次出现的路径，最终 fileSet 不落库（只 files 数组进 entry）
- 改动文件清单：
  - `types/usage.ts` + `electron/main/types.ts`：加 ToolCallRecord / ToolActivity / PermissionWaitRecord 三个 type；ConversationUsageEntry 删 toolCalls 加 toolActivity? + permissionWaits?；UsageJsonlLine 加 `({ kind: 'permission' } & PermissionWaitRecord)`
  - `electron/main/services/usage/usage-extractor.ts`：tool 计数 Map 升级，Read 收集 file_path（兼容 toolInput / input 两种字段名），输出 toolActivity
  - `electron/main/services/usage/usage-service.ts`：加 `appendPermissionWait(conversationId, record)`；readUsage 增加 pendingPermissions 暂存 + 时间窗口归属逻辑；totals.toolCallCount 改读 `entry.toolActivity?.totalCalls ?? 0`
  - `electron/main/tipc/usage.ts`：加 `recordPermissionWait` RPC
  - `components/agent-chat/usage-badge/UsageByTool.tsx`：`entry.toolCalls` → `entry.toolActivity?.calls`
  - `components/agent-chat/usage-badge/UsageEntryRow.tsx`：同上
  - `components/agent-chat/PermissionRequestCard.tsx`：加 reportWait() helper（从 useConversationStore.getState().selectedConversation 取 conversationId，block.timestamp 作 requestedAt），6 个 handle* 函数响应后 fire-and-forget 上报
- 关键类型签名：
  ```ts
  interface ToolCallRecord { name: string; count: number; files?: string[]; }
  interface ToolActivity { calls: ToolCallRecord[]; totalCalls: number; }
  interface PermissionWaitRecord {
    toolName: string;
    decision: 'allow' | 'deny' | 'always_allow' | 'allow_session';
    waitMs: number;
    requestedAt: number;  // ms
  }
  ```
- 权限上报 IPC：`client.recordPermissionWait({ conversationId, record })`

### 给下一步的接力棒
- 读 toolActivity：`entry.toolActivity?.calls ?? []`（calls 已按 count desc 排序），重读文件清单在 `call.files`（仅 Read 工具有，其他工具该字段不存在）
- 读 permissionWaits：`entry.permissionWaits ?? []`，每条 record 有 `{ toolName, decision, waitMs, requestedAt }`
- 旧 JSONL 兼容：旧行的 toolCalls 字段进 rest 后被忽略；readUsage 把它当 unknown 字段静默扔掉；旧对话 UI 显示 toolActivity 为空（空 calls，totalCalls=0），不报错
- Step 3 聚合接口：
  - "重读文件 Top N" → 跨所有 entry 聚合 `entry.toolActivity.calls.filter(c => c.name==='Read').flatMap(c => c.files ?? [])`，按 path 计数
  - "重读 vs 上次 Read 间隔轮数 / 是否跨 compact" → 用 entry.turnIndex + compactMarkers.afterTurnIndex 在 Step 3 里派生
  - "缓存命中率按 5m / 1h 分" → 用 `entry.usage.cacheCreation?.ephemeral5mInputTokens` / `ephemeral1hInputTokens`（已有字段，无需 Step 2 改动）
  - "权限等待 Top N" → 跨所有 entry 聚合 `entry.permissionWaits ?? []`，按 toolName 求 sum/avg waitMs
- 已知限制：
  - permission 行的归属是「读时近似」而非「写时精确」：极端情况下若某轮 entry 还未落盘就发生权限（理论上发生在子代理嵌套场景），该 permission 会先暂存等下次 readUsage 时归属
  - Read 工具的 file_path 字段来自 turnMessages 流式累积；如果某次 Read 调用尚未 finalize（toolInput=null），不会被收集到 files
  - PermissionRequestCard 从 store 取 `selectedConversation.id`，多附件场景（session window vs 主窗口）下若用户在窗口 A 点权限按钮但 selectedConversation 是窗口 B 的对话，会归错。当前用户操作流程不会触发此场景，但后续可改为通过 props 显式透传 conversationId 解决
