# Token 优化实施计划

**目标**：按 [token-optimization-design.md](../token-optimization-design.md) Phase 1/2/3 落地三项优化：RTK Hook 自动化、Usage 观察细化、缓存策略可控。Phase 4（大文件 Read 截断）等 Phase 2 跑 1-2 周数据后再定范围，本计划不含。

**架构思路**：
- **解耦**：每个 Phase 拆 1-2 个 step，跨 Phase 无强依赖（可乱序做）；Phase 内部数据层 → SDK 集成 → UI 单向依赖
- **复用既有模式**：cachePolicy 切换走模型切换同款 needsRestart + sessionRestartTrigger 流程，UI 用同款徽章+下拉，不另起轮子
- **不做兼容层**：新字段直接加，不留废弃字段；usage JSONL 旧行靠 optional 兼容

**涉及模块**：
- Hook：`.claude/hooks/rtk-rewrite.ps1`、`.claude/settings.json`、`.claude/CLAUDE.md`
- 数据层：`types/usage.ts`、`types/electron-api.ts`、`electron/main/services/usage/`、`electron/main/services/conversation-service.ts`
- SDK 集成：`electron/main/agents/agent-query-config.ts`、`electron/main/tipc/agent.ts`
- 前端：`components/agent-chat/usage-badge/`、`components/agent-chat/ChatInputArea.tsx`、`stores/conversation-store.ts`
- Skill：`.claude/skills/brainstorming/SKILL.md`

## 步骤索引

- [x] [Step 1: RTK Hook 自动化](./step1-rtk-hook.md) — 写 PowerShell hook 自动给 Bash 命令加 rtk 前缀，删 CLAUDE.md 里 80 行 RTK 规则段
- [x] [Step 2: Usage 数据层扩展](./step2-usage-extractor.md) — usage entry 加 toolActivity（工具调用+Read 文件清单）+ permissionWaits（权限等待时长）字段
- [x] [Step 3: Usage UI 新增维度](./step3-usage-ui.md) — UsageHoverCard 加"重读文件" + "权限等待"两个折叠区，缓存命中率按 5m/1h 区分
- [x] [Step 4: cachePolicy 数据模型 + 持久化](./step4-cache-policy-model.md) — Conversation 加 cachePolicy 字段，create 默认 5m，fork 继承父
- [x] [Step 5: cachePolicy SDK 集成](./step5-cache-policy-sdk.md) — agent-query-config 按 cachePolicy 设 ENABLE_PROMPT_CACHING_1H env，新增 setSessionCachePolicy RPC
- [x] [Step 6: cachePolicy UI + skill 提示](./step6-cache-policy-ui.md) — ChatInputArea 加缓存徽章，brainstorming skill 顶部加 1h 缓存建议

## 全局决策

### 命名与字段
- usage 新字段 camelCase（`toolActivity`、`permissionWaits`、`cachePolicy`），前端展示走 `toCompat()` 转换（如有需要）
- 工具活动抽象成 `ToolActivity { calls: ToolCallRecord[]; totalCalls }` 而非 `ReadActivity`，结构预留扩展（未来可加 Edit / Bash 等工具维度），命名参考 OpenTelemetry 的 `claude_code.tool` span 概念但**不引入 OTel collector**
- 权限等待时长 `PermissionWaitRecord { toolName, decision, waitMs, requestedAt }`，借鉴 OTel 的 `tool.blocked_on_user` 维度
- cachePolicy 字面量 `'5m' | '1h'`，与 SDK env 行为对齐：`'5m'` 不设 env（默认），`'1h'` 设 `ENABLE_PROMPT_CACHING_1H=1`

### worker 任务策略
Digest / Review / Categorize 这类 worker 任务**强制 5m 缓存**，不读 conversation.cachePolicy。理由：worker 任务短促一次性，1h 写入是 2x base 不划算。

### 切换交互
cachePolicy 切换跟模型切换一样需要会话重启（env 是 SDK 启动级，无法 per-request 切）。复用 `needsRestart` 返回值 + `sessionRestartTrigger` 链路。在 pendingState 非 idle 时禁用切换器。

### Hook 兜底
- rtk.exe 未安装时 hook 不阻塞，stderr 警告即可
- 命令解析失败保留原命令，不报错
- 已带 rtk 前缀的命令跳过（防双重套）

### 验证方式
- Phase 1：跑 5-10 条常见 Bash 命令观察日志
- Phase 2：开 3-5 个真实会话跑一周后导 usage JSONL 看新维度
- Phase 3：新建会话默认 5m，切到 1h 后看 SDK 启动 env 与 usage 缓存计费比率变化

## 执行顺序建议

```
Step 1 ─ 独立完成（最小风险，立即收益）
Step 2 → Step 3 ─ Phase 2 内串行
Step 4 → Step 5 → Step 6 ─ Phase 3 内串行
```

跨 Phase 可乱序，但单次会话内串行更易追踪。

## 完成总结

### 已落地（Phase 1/2/3 全部）

- **Phase 1（Hook 自动化）**：Step 1 — PowerShell rtk-rewrite hook 自动包装 Bash 命令，省下 CLAUDE.md 80 行规则段
- **Phase 2（Usage 可观察）**：Step 2/3 — usage entry 增 `toolActivity` + `permissionWaits`；HoverCard 新增「重读文件」「权限等待」折叠区，缓存命中率拆 5m/1h
- **Phase 3（缓存策略可控）**：Step 4/5/6 —
  - Conversation 表加 `cachePolicy?: '5m' | '1h'`，create 默认 5m / fork 继承父
  - `setConversationCachePolicy` IPC（纯写库）+ `setSessionCachePolicy` IPC（写库 + needsRestart）
  - SDK 启动时按 cachePolicy 注入 `ENABLE_PROMPT_CACHING_1H=1` env；worker 任务（digest/review/categorize）天然走 5m
  - ChatInputArea 工具栏 `CachePolicySelector` 徽章，切换走 confirm → triggerSessionRestart
  - brainstorming skill 顶部追加 1h 长对话缓存建议

### 数据流速记

```
conversation.cachePolicy
  ↓ (buildConversationSessionConfig)
QueryBasedSessionConfig.cachePolicy
  ↓ (start → ctx)
QueryRuntimeContext.cachePolicy
  ↓ (buildQueryBaseConfig)
env.ENABLE_PROMPT_CACHING_1H = '1' (仅 1h)
  ↓
query() SDK 子进程
```

切换链路：`CachePolicySelector` → `client.setSessionCachePolicy` → `conversationService.updateCachePolicy` + `QueryBasedSession.setCachePolicy` → 返回 `needsRestart` → `triggerSessionRestart` → useAgentSession 重建会话 → 新 env 生效。

### 后续追踪（Phase 4 暂缓）

Phase 4（大文件 Read 截断）依据 Step 3 上线后 1-2 周的真实 usage 数据决策，包含：
- toolActivity.calls 里 Read 工具的 inputTokens 分布（找超大文件）
- 同一文件被重复 Read 的次数（命中缓存的潜力）
- permissionWaits.waitMs 中位数（用户切换缓存策略的体感成本）

数据稳定后另起 `2026-07/.../read-truncation/` plan 目录。
