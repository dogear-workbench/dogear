# pi AgentHarness 迁移前瞻 & SDK 移除前可做的事项

**背景**：pi 主会话（PiSession）当前使用裸 `Agent` + 手写包装，消息纯内存无持久化，关闭即丢失。`@earendil-works/pi-agent-core` 提供 `AgentHarness` 上层封装，内置 JSONL 树形持久化、compaction、hook 系统。本文记录迁移方向调研结论，留待 SDK 移除时一并实施。

**目标**：落盘调研成果，不立即实施；同时梳理 SDK 移除前可以提前做的增量改进。

---

## 一、AgentHarness 架构概览

### 三大核心能力

#### 1. Session 持久化（JsonlSessionRepo + JsonlSessionStorage）

**文件格式**：单文件 = 单会话，JSONL 逐行追加。

```
第 1 行（header）：{ type: "session", version: 3, id, cwd, timestamp, parentSession? }
第 2+ 行（entry）：每行一个 SessionTreeEntry，带 id + parentId 构成文件内树
```

**Entry 类型**：
| type | 用途 |
|------|------|
| `message` | 用户/助手消息（`AgentMessage`） |
| `leaf` | 标记当前分支末端（支持分支切换） |
| `compaction` | 压缩摘要（替代旧消息进入上下文） |
| `branch_summary` | 分支摘要（fork 时生成） |
| `label` | 给某个 entry 打标签 |
| `model_change` / `thinking_level_change` / `active_tools_change` | 状态变更记录 |
| `custom` / `custom_message` | 扩展点 |

**关键 API**：
- `JsonlSessionRepo.create/open/list/delete/fork` — 仓库级操作
- `JsonlSessionStorage.open/create` — 单会话存储（读写 JSONL 文件）
- `Session.appendMessage/appendCompaction/moveTo/buildContext` — 会话级操作
- `Session.getPathToRootOrCompaction(leafId)` — 从叶子到根（或最近 compaction）的 entry 路径，用于构建上下文

**fork 原生支持**：`repo.fork(source, { entryId, position })` 从任意 entry 分叉出新会话文件。

#### 2. Compaction（上下文压缩）

- `prepareCompaction` → 找切点 + 分割消息 → `generateSummary` → `appendCompaction`
- `SessionBeforeCompact` hook 可拦截/取消/替换压缩
- `buildContext` 自动处理：遇到 compaction entry 用摘要替代旧消息
- 纯函数算法（`findCutPoint` / `estimateContextTokens`），吃 `SessionTreeEntry[]`

#### 3. Hook 系统

| hook | 时机 | 可干预 |
|------|------|--------|
| `before_agent_start` | 每轮开始 | 可改 messages / systemPrompt |
| `context` | 构建上下文 | 可改 messages |
| `tool_call` | 工具调用前 | 可 block |
| `tool_result` | 工具调用后 | 可改结果 |
| `session_before_compact` | 压缩前 | 可取消/替换 |
| `session_before_tree` | 分支切换前 | 可取消/替换摘要 |
| `before_provider_request` | 发请求前 | 可改 streamOptions |
| `before_provider_payload` | 发请求前 | 可改 payload |

### 自动持久化闭环

AgentHarness 的 `handleAgentEvent`：
- `message_end` → `session.appendMessage(event.message)` — 消息自动落盘
- `turn_end` → `flushPendingSessionWrites()` — 模型/思考级别变更等也落盘
- `agent_end` → `flushPendingSessionWrites()` + 广播 `settled`

**与 PiSession 对比**：PiSession 的 `handleAgentEvent` 只 emit 给前端，不入库。AgentHarness 的持久化是"免费"的。

---

## 二、PiSession → AgentHarness 迁移碰撞点

### 存储格式

| 维度 | SDK 会话 | pi 当前 | AgentHarness |
|------|---------|---------|-------------|
| 文件路径 | `.dogear/conversations/projects/{wsPath}/{sdkSessionId}.jsonl` | 无 | `{sessionsRoot}/{sessionId}.jsonl`（sessionsRoot 待定） |
| 格式 | SDK 原生 JSONL（线性） | 无 | pi SessionTreeEntry JSONL（树形） |
| fork | 新 session id + SDK resume | 未实现 | `repo.fork()` 原生 |
| resume | sdkSessionId 读 JSONL | 未实现 | `repo.open()` + `buildContext()` |

**迁移需解决**：
- conversations.json 的 `sdkSessionId` 字段语义变更为 pi session path（或新增字段）
- 老的 SDK JSONL 历史是否迁移（可选：保留只读 / 写转换脚本 / 不迁移）

### 工具权限

| 维度 | PiSession 当前 | AgentHarness |
|------|---------------|-------------|
| 拦截点 | `Agent` 构造参数 `beforeToolCall` | `harness.on('tool_call', handler)` 返回 `{ block, reason }` |
| 免确认白名单 | `permission-rules.ts` 硬编码 Set | 同样，在 hook handler 里做 |
| 弹窗确认 | emit `permissionRequest` 事件 | hook handler 里 await Promise（同 pattern） |
| 持久化规则 | `settings.permissionRules.allow` | 不变 |

机制对称，改动是从 `beforeToolCall` 参数迁移到 `tool_call` hook。

### 流式事件

PiSession 当前 `agent.subscribe` → `convertPiEvent` → emit `message`。

AgentHarness 的 `subscribe` 收到 `AgentHarnessEvent`（`AgentEvent` 的超集），额外有：
- `save_point` / `settled` / `context` / `tool_call` / `tool_result`（结构化版本）
- `session_compact` / `session_tree` / `model_update` 等

**thinking**：底层 AgentEvent 的 `message_update` 里的 `thinking_delta` 一样可用，converter 改动不受影响。

### 前端历史加载

当前 `useMessageHistory` → `client.getSdkSessionHistory({ sdkSessionId })` → tipc 读 SDK JSONL。

迁移后需要新的 tipc handler 读 pi JSONL（`JsonlSessionStorage.open` → `getEntries` → 转换为前端消息格式）。或者直接让 AgentHarness 的 Session 重建上下文，前端只负责展示。

### 前端消息展示

AgentHarness 的 entry 类型比 SDK 丰富（compaction、branch_summary、model_change 等），前端 ContentBlockItem 需要适配新类型。但核心 message 格式（`AgentMessage`）与裸 Agent 一致，text/tool_use/tool_result 的渲染不需要改。

---

## 三、Thinking 显示（已确认要做，最小改动）

**当前状态**：`message-converter.ts` 只转 `text_delta`，忽略 `thinking_*` 事件。

**方案**：delta-only 最小改动，与 text 处理完全对称：
- `thinking_delta` → `{ type: 'thinking', content: ame.delta, timestamp }`
- `thinking_start` / `thinking_end` → `null`（忽略）

前端已有完整渲染链（`transformers.ts` thinking 合并、`ContentBlockItem.tsx` → `<ThinkingBlock>`），零改动。

**已知限制**（留待 SDK 移除后优化）：
- thinking/text 交替时块边界不精确（实际影响极小，模型通常先想完再写回复）
- 不利用 `thinking_end.content` 做最终校准

---

## 四、SDK 移除前可提前做的事项

以下事项**不依赖 AgentHarness、不依赖 SDK 移除**，可以在当前 PiSession 架构上独立推进。

### 1. Thinking 显示

**改动**：`electron/main/agents/pi-session/message-converter.ts` 一个文件。

- `thinking_delta` → `{ type: 'thinking', content: ame.delta, timestamp }`
- `thinking_start` / `thinking_end` → `null`（忽略，与 `text_start`/`text_end` 对称）

前端已有完整渲染链（`transformers.ts` thinking 合并、`ContentBlockItem.tsx` → `<ThinkingBlock>`），零改动。

**已知限制**（留待 AgentHarness 迁移时优化）：
- thinking/text 交替时块边界不精确（实际影响极小）
- 不利用 `thinking_end.content` 做最终校准

### 2. 权限全绿灯模式

**目标**：用户可选择「全部自动放行」，所有工具调用不弹窗。

**改动**：`electron/main/agents/pi-session/pi-session.ts`

- `setPermissionMode` 从 no-op 变成真实实现，存储当前模式（`default` / `autoApprove`）
- `handleBeforeToolCall` 开头判断模式，`autoApprove` 时直接 `return undefined`（放行）
- 权限模式可在会话级别切换（前端入口、设置页）

与 SDK 侧的 `setPermissionMode('dontAsk')` 语义对齐，微信 bot 和子会话已用此模式。

### 3. Token / 上下文用量显示

**问题**：pi 侧没有 emit `usageContext` 事件，前端 `UsageBadge` 的上下文进度条不显示（`latestContext` 恒 `undefined`）。

**改动**：`electron/main/agents/pi-session/pi-session.ts` + `usage-extractor.ts`

- 在 `message_end` 事件里，从 `AssistantMessage.usage` 提取上下文大小：
  - `used = usage.input + usage.cacheRead + usage.cacheWrite`（该轮发给 LLM 的全部输入 token ≈ 当前上下文大小）
  - `limit = MODEL_CONTEXT_WINDOWS[modelId]`（已有 `MODEL_CONTEXT_WINDOWS` 常量）
- 组装 `ContextSnapshot` 并 emit `usageContext` 事件
- 前端 `useConversationUsage` / `UsageBadge` 零改动（已监听 `usageEntryAdded` → refetch → 读 `latestContext`）

**不需要 AgentHarness**：裸 Agent 每轮 usage 已携带足够信息，手动算 snapshot 即可。

### 以下事项留到 SDK 移除后

| 事项 | 原因 |
|------|------|
| AskUserQuestion 工具 | 前端组件已存在，但 pi 侧需注册工具 + 事件路由，与卡片体系一起做更合理 |
| Task 卡片 / SubAgent | 依赖子会话派遣（delegation），需重写编排层 |
| Delegation / 多会话 | 深度依赖会话生命周期管理 + 持久化 |
| 持久化 / Fork | 依赖 AgentHarness 的 Session 模型 |
| Compaction | 依赖 AgentHarness 的压缩算法 |

---

## 五、未决问题

- AgentHarness 的 `sessionsRoot` 目录怎么对应 dogear 的 workspace 概念
- conversations.json 需要哪些字段变更来对接 pi session
- 老的 SDK JSONL 历史迁移策略
- AgentHarness 的 compaction 是否替代当前手写的上下文管理（如果有）
- AgentHarness 需要 `FileSystem` 抽象，dogear 的 `WorkspaceExecutionEnv` 是否可复用
- `AgentHarnessTool` 比 `AgentTool` 多一个 `context` 参数，工具适配层 (`toPiTools`) 需要改

## 六、决策记录

- **明天实施**（3 项，均为小改动，不依赖 AgentHarness）：
  1. Thinking 显示 — 改 message-converter.ts
  2. 权限全绿灯模式 — 实现 setPermissionMode
  3. Token / 上下文用量 — emit usageContext 事件
- **留到 SDK 移除后**：AgentHarness 迁移 + 持久化 + 卡片工具 + Delegation，本文档留参考
