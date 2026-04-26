# DeepSeek V4 接入与模型配置增强设计

> 日期：2026-04-26
> SDK 版本：@anthropic-ai/claude-agent-sdk 0.2.119
> 关联记忆：feedback_no_compat.md（开发阶段不做兼容）

## 背景

DeepSeek V4 通过 Anthropic 兼容端点提供服务，本身与我们现有 Profile 体系（`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + 三层模型映射）已经完全兼容，**不需要为 DeepSeek 做专门适配**。

但对照 DeepSeek 文档与 SDK 0.2.119 能力，发现几处当前未利用的 SDK/CLI 能力值得暴露出来：

1. **子代理模型独立选择** — CLI 读取 `CLAUDE_CODE_SUBAGENT_MODEL` 指定子代理走哪一层
2. **默认模型指定** — CLI 读取 `ANTHROPIC_MODEL` 作为主模型默认值
3. **思考模式简化** — Opus 4.7+ 不再支持 `thinking.type=enabled` 的手动预算，官方推荐 `adaptive`；我们可以删掉对应 UI
4. **effort 档位补齐** — SDK 支持 5 档 `low/medium/high/xhigh/max`，当前只暴露 4 档
5. **运行时模型切换** — SDK 提供 `Query.setModel()`，可以在输入框层面做即时切换

## 设计目标

- **精简**：删除已被 SDK 弃用的手动思考预算配置
- **增强**：暴露 SDK 已支持但未利用的模型选择能力
- **不兼容旧数据**：按既定偏好，开发阶段直接删字段，不保留迁移代码

## 方案总览

### 运行时能力确认

| 能力 | SDK 方法 | 本次是否接入 |
|---|---|---|
| 运行时改模型 | `Query.setModel(model?)` | ✅ 是 |
| 运行时改 effort | ❌ 无 | — |
| 运行时改 permission | `Query.setPermissionMode()` | 已有 |
| 列可用模型 | `Query.supportedModels()` | ❌ 不用（只返回官方 Anthropic 模型，第三方如 DeepSeek 不在列表） |

**结论**：effort 在运行时不可改，所以输入框里不做 effort 切换；模型可改，在输入框做层级切换。

## 详细设计

### 1. 类型变更

**文件**：`types/settings.ts` + `electron/main/services/settings-types.ts`（镜像）

**删除**：
```ts
export interface ThinkingConfig { ... }                   // 整个类型删除
AppSettings.ai.thinking: ThinkingConfig                   // 字段删除
DEFAULT_SETTINGS.ai.thinking                              // 默认值删除
```

**修改**：
```ts
AppSettings.ai.effort: 'low' | 'medium' | 'high' | 'max'
// 改为
AppSettings.ai.effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
```

**新增**：
```ts
AppSettings.ai.defaultModelTier?:  'haiku' | 'sonnet' | 'opus'
AppSettings.ai.subagentModelTier?: 'haiku' | 'sonnet' | 'opus'
```

两个 tier 字段均可选。`undefined` 表示不注入对应 env var，走 SDK/CLI 默认行为。

### 2. 环境变量注入

**文件**：`electron/main/agents/agent-query-config.ts`

在 `buildQueryBaseConfig()` 内，原有三个 `ANTHROPIC_DEFAULT_*_MODEL` 保持不变，新增两个条件注入：

```ts
const tierMap = {
  haiku:  activeProfile.haikuModel,
  sonnet: activeProfile.sonnetModel,
  opus:   activeProfile.opusModel,
};

if (appSettings.ai.defaultModelTier) {
  env.ANTHROPIC_MODEL = tierMap[appSettings.ai.defaultModelTier];
}
if (appSettings.ai.subagentModelTier) {
  env.CLAUDE_CODE_SUBAGENT_MODEL = tierMap[appSettings.ai.subagentModelTier];
}
```

**`QueryBaseConfig` 接口**：
- 删除 `thinking` 字段
- 其他字段不变

### 3. Query 调用点

**文件**：`electron/main/agents/query-based-session.ts` + `electron/main/agents/agent-worker.ts`

所有 `thinking: baseConfig.thinking` 传递改为硬编码：
```ts
thinking: { type: 'adaptive' }
```

`effort` 传递逻辑保持不变（已经走 `baseConfig.effort`）。

### 4. 运行时 setModel 接入

**`QueryBasedSession` 新增方法**：
```ts
async setModel(tier?: 'haiku' | 'sonnet' | 'opus'): Promise<void> {
  const modelStr = tier ? this.tierToModelString(tier) : undefined;
  await this.query.setModel(modelStr);
  // 同时记录当前 tier 到 session state，用于前端回显
}
```

`tierToModelString()` 读取当前激活 Profile 的对应模型名。

**新增 tipc RPC**（`electron/main/tipc/agent.ts`）：
```ts
setSessionModel: t.procedure
  .input<{ conversationId: string; tier?: 'haiku' | 'sonnet' | 'opus' }>()
  .action(async ({ input }) => {
    const session = sessionRegistry.get(input.conversationId);
    if (!session) throw new Error('会话不存在');
    await session.setModel(input.tier);
  });
```

### 5. 设置页 UI

**文件**：`app/settings/` AI 行为 Tab

**删除**：
- 思考模式 `type` 选择器（adaptive / enabled / disabled 三选一）
- `budgetTokens` 输入框

**修改**：
- effort 下拉选项由 4 档改为 5 档：`低 / 中 / 高（默认）/ 超高 / 最大`

**新增两个下拉**：
- **默认模型层级**：`不指定 / Haiku / Sonnet / Opus`
  - 帮助文本：对应注入 `ANTHROPIC_MODEL`，决定 CLI 启动时的默认模型
- **子代理模型层级**：`不指定 / Haiku / Sonnet / Opus`
  - 帮助文本：对应注入 `CLAUDE_CODE_SUBAGENT_MODEL`，决定 Task 工具启动的子代理用哪一层

### 6. 输入框模型切换

**文件**：`components/agent-chat/ChatInputArea.tsx` + 可能新增 hook

**删除**：
- 思考模式切换按钮（当前位置：输入框工具栏）
- 相关 store 状态（如果独立存在）

**新增**：
- 一个小下拉：`Haiku ▾ / Sonnet ▾ / Opus ▾`（当前值）
- 初始值来源：
  1. 会话 session 上的 currentTier（如果用户切过）
  2. 否则 `ai.defaultModelTier`（如果配了）
  3. 否则显示 `默认 ▾`（表示"让 SDK 决定"）
- 切换时调用 `client.setSessionModel({ conversationId, tier })`
- 会话关闭/切换时组件自身重置状态（不跨会话持久化，符合 feedback_ephemeral_ui_state）

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `types/settings.ts` | 删 `ThinkingConfig` / `ai.thinking`；加 `xhigh`；加两个 tier 字段 |
| `electron/main/services/settings-types.ts` | 同步类型 |
| `electron/main/agents/agent-query-config.ts` | 删 `thinking` 字段；加两个 env 条件注入 |
| `electron/main/agents/query-based-session.ts` | 删 `thinking` 传参；加 `setModel()` 方法 |
| `electron/main/agents/agent-worker.ts` | 删 `thinking` 传参 |
| `electron/main/tipc/agent.ts` | 加 `setSessionModel` RPC |
| `lib/client.ts` 等类型 | 如涉及 RPC 客户端类型，同步 |
| `app/settings/*`（AI 行为 Tab 组件） | 删思考模式 UI；加 `xhigh` 选项；加两个 tier 下拉 |
| `components/agent-chat/ChatInputArea.tsx` | 删思考按钮；加模型层级下拉 |
| `stores/settings-store.ts` | 表单字段同步 |

## 数据流

### 配置变更流
```
设置页 → settings-store → settings.json → (下次会话启动) agent-query-config → env 注入 → CLI 子进程
```

### 运行时切换流
```
输入框下拉 → client.setSessionModel() → tipc/agent.setSessionModel → QueryBasedSession.setModel() → SDK Query.setModel() → (下一条消息生效)
```

## 不做的事（YAGNI）

- ❌ 不添加 `CLAUDE_CODE_EFFORT_LEVEL` env 注入（SDK 的 `effort` option 已经覆盖，DeepSeek 会映射，重复会冲突）
- ❌ 不保留 `ThinkingConfig` 做兼容（按偏好直接删）
- ❌ 不做历史 settings.json 迁移逻辑（直接读不兼容也不报错，字段 undefined 即可）
- ❌ 不为 DeepSeek 做专门的 Profile 预设模板（用户直接填 baseUrl/apiKey/模型名即可）
- ❌ 不在输入框暴露 effort 切换（SDK 无运行时 setEffort）
- ❌ 不用 `supportedModels()` 列模型（返回官方模型，第三方不在）

## 风险与测试

### 风险
- **旧 settings.json 读到 `thinking` 字段**：`deepMerge()` 遇到目标没这个字段会怎么处理需验证。若合并后保留了，写回时自动丢弃即可（新类型里无这个字段）。
- **第三方 API 对某些 env var 的响应未知**：DeepSeek 对 `CLAUDE_CODE_SUBAGENT_MODEL` 的实际支持情况文档已明确写了。其他情况由用户自行尝试，失败的代价仅是"没生效"。

### 验证路径
1. 启动开发环境，确认已有会话仍可正常发消息
2. 设置页填上默认模型/子代理模型，重启会话，查看 Agent 日志中的 env 值
3. 输入框下拉切换模型，观察新消息的响应速度/质量差异（Haiku 应明显更快）
4. `effort` 选 `xhigh`，确认 SDK 不报错且 DeepSeek 端正常响应

## 实施顺序建议

1. 类型变更（types + settings-types）
2. 主进程 env 注入与 `thinking` 清理
3. `QueryBasedSession.setModel` + tipc RPC
4. 设置页 UI 改造
5. 输入框 UI 改造
6. 手动验证（见上）
