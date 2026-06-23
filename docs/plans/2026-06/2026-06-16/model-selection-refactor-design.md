# 模型选择重构设计

> 日期：2026-06-16
> 状态：设计已确认，待写实施计划
> 范围：把"全局选方案 + 档位"改为"对话级选(方案,档位)二元组"，统一前后台模型解析路径，修复插话状态机 bug

---

## 1. 背景与现状

### 当前机制
- 全局单选：`AppSettings.ai.activeProfileId` + `defaultModelTier`（haiku/sonnet/opus）
- 启动会话时 `agent-query-config.ts:136-186` 把方案展开成 env：注入 `ANTHROPIC_MODEL`（主档）+ `CLAUDE_CODE_SUBAGENT_MODEL`（独立子档 `subagentModelTier`）
- 运行时切档：`query-based-session.ts:1771-1793` 的 `setModel(tier)` 可在**同一方案**内切档（不重启）
- SDK 对子代理无直接 API，纯靠 env alias
- 三个后台任务（digest / review / categorize）各自有独立 `xxxProfileId + xxxModelTier`，handler 各自重建 env（结构高度同构，见 `agent-worker.ts:560-840`）

### 已识别的痛点
1. **作用域错位**：不同对话想用不同模型只能改全局，影响其他正在跑的对话
2. **UI 心智不直观**：用户想"选模型"，实际要去设置里选"方案 + 档位"两步
3. **插话状态 bug**：插话场景下，agent 完成第一轮 result 后前端就翻成 idle，但 `pendingMessages` 队列里还有插话待消费（`query-based-session.ts:155/1482`），导致 UI 误判会话结束

---

## 2. 设计目标

- **作用域**：对话级模型选择（per-conversation），切换 = 标脏，下次发送时 reconcile
- **UI**：「选模型」一步到位，按方案分组的二级菜单
- **统一**：前后台所有模型选择都收敛到同一个 `ModelSelection` 类型 + 同一个解析 helper
- **插话**：暴露 `pendingMessagesCount`，前端派生三态，插话过程不被误判为完成
- **不做兼容**（CLAUDE.md 项目硬约定）：旧字段直接换掉

---

## 2.5 关键行为契约（默认模型 vs 对话模型）

为避免实施时混淆，把这套模型选择的两层语义明确写死：

### A. 主会话路径（用户对话）

| 层级 | 字段 | 语义 |
|---|---|---|
| **全局默认** | `settings.defaultModelSelection` | **新建对话时模板**。用户在 AI 行为 tab 里选了什么模型，新建对话就拷贝该值。选了"不指定" → 新对话也是"不指定" |
| **对话级独立锁定** | `conversation.modelSelection` | 创建时从默认**拷贝**一份（**不是引用**），之后完全独立。用户改全局默认不影响已存在对话 |
| **解析时** | 用 `conversation.modelSelection` 解析 env，**不做** fallback 到 default | 因为创建时已拷贝；如果对话级是 null，UI 直接 disable 输入框 + 提示选模型 |

### B. 后台任务路径（digest / review / categorize）

| 层级 | 字段 | 语义 |
|---|---|---|
| **任务专用** | `settings.{digest,review,categorize}ModelSelection` | 优先用这个 |
| **回退** | `settings.defaultModelSelection` | 任务专用是 null 时**运行时 fallback** 到默认 |
| **再回退** | 抛错 | 默认也是 null → 任务报错跳过 |

**为什么后台用 fallback、主会话用拷贝**：后台任务没有"创建时刻"，每次都是按当前 settings 跑；主会话有明确的"新建对话"生命周期事件，可以在那一刻冻结模型，避免用户事后改设置影响进行中的对话。

---

## 3. 数据模型变更

### 3.1 新增公共类型

`types/settings.ts` + `electron/main/services/settings-types.ts` 双方同步新增：

```ts
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ModelSelection {
  profileId: string;
  tier: ModelTier;
}
```

### 3.2 `AppSettings.ai` 字段调整

**删除**：
- `activeProfileId: string`
- `defaultModelTier?: ModelTier`
- `digestProfileId?: string` + `digestModelTier?: ModelTier`
- `reviewProfileId?: string` + `reviewModelTier?: ModelTier`
- `categorizeProfileId?: string` + `categorizeModelTier?: ModelTier`

**新增**：
- `defaultModelSelection: ModelSelection | null` —— 新建对话继承的默认；可为 null（"不指定"）
- `digestModelSelection: ModelSelection | null` —— 后台提炼任务模型；null 时回退到 `defaultModelSelection`
- `reviewModelSelection: ModelSelection | null` —— 同上
- `categorizeModelSelection: ModelSelection | null` —— 同上

**保留**：
- `subagentModelTier?: ModelTier` —— 仍是全局设置，跟随主会话所在 profile 解析

### 3.3 `Conversation` 字段调整

`types/electron-api.ts` 的 `Conversation` 加：
- `modelSelection: ModelSelection | null`
  - **创建时复制语义**：新建对话时，从 `settings.defaultModelSelection` **复制**一份赋值给本字段（包括 null 情况——默认是 null，新对话就是 null）
  - 创建之后对话独立锁定，用户改全局默认不影响已存在的对话
  - null = 用户没选模型 → 发送被门禁拦下（"请先选择模型"）

`electron/main/services/conversation-service.ts` 的 `createConversation()`：
```ts
function createConversation(input): Conversation {
  return {
    ...input,
    modelSelection: settings.defaultModelSelection ?? null,  // 创建时拷贝，不是引用
    // ...
  };
}
```

### 3.4 任务 payload 字段调整

`electron/main/agents/task-types.ts` 的 `DigestSessionPayload / ReviewSessionPayload / CategorizeSessionPayload`：
- 移除 `digestModelTier / reviewModelTier / categorizeModelTier`
- 新增 `modelSelection?: ModelSelection`（可选，覆盖 settings 里的对应字段）

### 3.5 `DEFAULT_SETTINGS` 调整

- `defaultModelSelection: null`（首次启动用户必须先去设置里选）
- 三个后台 `xxxModelSelection: null`（默认回退到 default）
- `profiles.default` 仍是空模板（要求用户填）
- `getActiveProfile()` 函数删除（被 `resolveProfile()` 取代，见下节）

---

## 4. 后端改造

### 4.1 新增统一解析 helper

`electron/main/agents/agent-query-config.ts` 新增：

```ts
/**
 * 把 ModelSelection 解析成 { profile, modelId, env }
 * @param selection 选择的二元组；null 表示用 fallback
 * @param fallback 选项为 null 时的回退（通常是 defaultModelSelection）
 */
export function resolveModelSelection(
  appSettings: AppSettings,
  selection: ModelSelection | null,
  fallback: ModelSelection | null,
  configDir: string,
): { profile: ModelProfile; tier: ModelTier; modelId: string; env: Record<string, string> } {
  const target = selection ?? fallback;
  if (!target) throw new Error('未指定模型，请先在对话或设置中选择');
  const profile = appSettings.profiles[target.profileId];
  if (!profile) throw new Error(`方案 ${target.profileId} 不存在`);
  if (!isProfileComplete(profile)) throw new Error(`方案「${profile.name}」配置不完整`);

  const claudeConfigDir = path.join(configDir, 'conversations');
  const env = buildProfileEnv(profile, claudeConfigDir);
  const tierMap = { haiku: profile.haikuModel, sonnet: profile.sonnetModel, opus: profile.opusModel };
  env.ANTHROPIC_MODEL = tierMap[target.tier];

  // 子代理跟随主 profile，tier 用全局 subagentModelTier（无则不注入，SDK 走默认）
  const subagentTier = appSettings.ai.subagentModelTier;
  if (subagentTier) env.CLAUDE_CODE_SUBAGENT_MODEL = tierMap[subagentTier];

  return { profile, tier: target.tier, modelId: tierMap[target.tier], env };
}
```

### 4.2 `buildQueryBaseConfig` 重构

- 移除 `getActiveProfile()` 调用
- 接收 `conversationModelSelection: ModelSelection | null` 参数（从 conversation 数据流过来）
- 调 `resolveModelSelection(appSettings, conversationModelSelection, defaultModelSelection, configDir)` 拿到 env / profile / tier
- 返回的 `QueryBaseConfig` 用新字段 `resolvedProfile / resolvedTier` 替代 `activeProfile`

### 4.3 三个后台 handler 收敛

`agent-worker.ts:560-840` 的 digest / review / categorize 三段几乎重复的 env 重建代码改成：

```ts
const selection = payload.modelSelection
  ?? baseConfig.appSettings.ai.digestModelSelection   // 或 review / categorize
  ?? baseConfig.appSettings.ai.defaultModelSelection;
const { env, tier, profile } = resolveModelSelection(
  baseConfig.appSettings, selection, null, this.configDir,
);
// haiku 不传 effort 的逻辑保留
```

### 4.4 `query-based-session.setModel`

- 签名扩为 `setModel({ profileId, tier })`
- 内部判断：profileId 跟当前会话相同 → 走 SDK `query.setModel()` 快速路径（同 profile 内换档不重启）
- profileId 不同 → 返回 `{ needsRestart: true }`，让上层走重启路径（不在这里做重启，因为重启要重建整个 QueryBasedSession）

### 4.5 IPC 接口调整

`electron/main/tipc/agent.ts`：
- `setSessionModel({ sessionId, tier })` → `setSessionModel({ sessionId, selection: ModelSelection })`
- 内部按 4.4 处理；跨 profile 时返回 `needsRestart: true` 给前端
- 新增 `getSessionStatus({ sessionId })` 返回 `{ running, pendingMessagesCount }`（如果现有的 status 接口已有则扩展，没有就新增）
- `interruptQueryBasedSession` 行为不变：abort 当前轮 + 清空 pendingMessages

### 4.6 `query-based-session` 暴露插话状态

- `pendingMessages` 队列的长度通过现有 sessionMessage 事件附带，或新增专用事件 `pendingCountChanged`
- 每次 push / shift 时 emit 一次
- `interrupt()` 内部清空队列时也 emit 一次 0

---

## 5. 前端改造

### 5.1 ChatInputArea 档位下拉改造

`components/agent-chat/ChatInputArea.tsx:82-83 / L340-385`：

- props 改 `currentSelection?: ModelSelection | null` + `setCurrentSelection(s: ModelSelection | null) => void`
- 下拉菜单改成按方案分组的二级菜单，**只展示模型名（modelId）**，不展示档位标签：
  ```
  Anthropic 官方
    claude-opus-4-7
    claude-sonnet-4-6
    claude-haiku-4-5
  Bedrock
    anthropic.claude-opus-4-7
    anthropic.claude-sonnet-4-6
  ```
- **档位是后端映射的内部细节，UI 完全不感知**。用户视角上"模型 = 名字"，跨档同名只是巧合
- **去重规则**：同 profile 内若三档槽位填了相同 modelId，列表只显示一项（避免重复行）
  - 抽工具函数 `dedupeProfileTiers(profile): Array<{ tier, modelId }>`，内部按 opus > sonnet > haiku 优先级保留对应 tier
  - 用户点选这一项 → 持久化的 `ModelSelection.tier` = 去重时保留的那个 tier
  - 这套 tier 选择策略对用户透明；用户看到的只是"我选了 claude-opus-4-7"
- 选了后调 `setCurrentSelection`，**不**立即调 `setSessionModel`（reconcile 留到发送时做）
- 当 `currentSelection` 为 null 时，dropdown 显示"请选择模型"占位 + 红色提示样式

### 5.2 设置页改造

**AI 行为 tab（`app/settings/page.tsx:276-360+`）**：
- L302-320「默认模型」就地替换：原 haiku/sonnet/opus 简单下拉 → 5.1 的按方案分组二级菜单组件 + "不指定"项（绑定 `defaultModelSelection`）
  - 文案改为：「新建对话默认使用此模型；选「不指定」时新对话需手动选择模型才能发消息」
  - **行为契约**：此处的选择**仅影响之后新建的对话**（创建时复制），不影响已存在对话的 `modelSelection`
- L322-341「子代理档位」保留，文案补充「跟随主会话所在方案的同名档位」

**Profiles tab（L73-83 / L191-198 / L494-515）**：
- 删除"激活方案"单选 UI（这个概念被 `defaultModelSelection` 取代）
- profiles 列表本身保留（增删改方案的 CRUD 不变）

**会话摘要 tab**（`app/settings/memory/SmartCategoryPanel.tsx` 与同级提炼/复盘 section）：
- 原本 `digestProfileId + digestModelTier` 两个独立控件 → 改成一个 5.1 的二级菜单组件（绑定 `digestModelSelection`）+ "不指定"项
- 同理改造 `reviewModelSelection` / `categorizeModelSelection`
- 行为：null 时回退到 `defaultModelSelection`（这是**运行时 fallback**，因为后台任务没有"创建时刻"可言）

### 5.3 发送前 reconcile

`components/agent-chat/hooks/useSendMessage.ts:447`：

```ts
async function send(...) {
  if (isAgentRunning) {
    // 插话特例：直接 push 队列，沿用上次模型
    await client.sendQueryBasedSessionMessage(...);
    return;
  }

  // 主会话不做 fallback —— conversation.modelSelection 在创建时已从 default 拷贝
  // 这里如果是 null，说明用户在 ChatInputArea 主动选了"不指定"或老对话没字段
  const conv = getConversation(conversationId);
  if (!conv.modelSelection) {
    toast.error('请先选择模型');
    return;
  }

  const wantedSelection = conv.modelSelection;
  const currentSelection = currentSessionModelSelection;  // 从 session 状态读
  if (sameSelection(currentSelection, wantedSelection)) {
    // 直接发
  } else if (currentSelection?.profileId === wantedSelection.profileId) {
    // 同 profile 换 tier
    await client.setSessionModel({ sessionId, selection: wantedSelection });
  } else {
    // 跨 profile 换：触发重启，等会话重建完再发
    incrementSessionRestartTrigger();
    await waitForSessionReady();
  }
  await client.sendQueryBasedSessionMessage(...);
}
```

**注意**：UI 上 ChatInputArea 当 `conv.modelSelection === null` 时整个输入框 disabled，让用户从下拉里选一个；理论上不会走到 toast 那条分支，toast 只是兜底防御。

### 5.4 派生插话三态

新增 hook `usePendingState(sessionId)`，返回：
- `idle` —— `running=false && pendingCount=0`
- `running` —— agent 在生成
- `flushing` —— agent 给了 result 但 `pendingCount > 0`

`AgentChat.tsx` / `ChatInputArea.tsx`：
- 「停止 / 发送」按钮的判定从 `isRunning` 改成 `state !== 'idle'`
- StreamingIndicator 在 flushing 时显示「队列还有 N 条插话待回复」

### 5.5 store 调整

- `conversation-store.ts`：actions 加 `setConversationModelSelection(id, selection)`；conversation 类型镜像加 `modelSelection`
- `settings-store.ts`：默认值同步；保存逻辑无需特殊处理（整体 save 模式）

---

## 6. 插话状态机

### 6.1 后端

`query-based-session.ts`：
- `pendingMessages.push(...)` 后 emit `pendingCountChanged: { count }`
- `pendingMessages.shift()` 后 emit `pendingCountChanged: { count }`
- `interrupt()` 内：`pendingMessages.length = 0`; emit `pendingCountChanged: { count: 0 }`; `abortController.abort()`

### 6.2 IPC 事件

`electron/main/tipc/renderer-handlers.ts` 加事件：
- `pendingCountChanged: { sessionId, count }`

### 6.3 前端订阅

`useAgentSession.ts` 维护 `pendingCount` state，监听 `pendingCountChanged` 事件。

### 6.4 "完成" 判定语义

- result 事件 → `running = false`
- pendingCount 事件 → `pendingCount = N`
- 派生态：`idle = !running && pendingCount === 0`
- 只有 idle 才显示"发送"按钮；running / flushing 都显示"停止"

---

## 7. 完整影响范围清单

### 类型与默认值
- [ ] `types/settings.ts` —— 加 `ModelSelection`，删旧字段，加新字段，改 `DEFAULT_SETTINGS`
- [ ] `electron/main/services/settings-types.ts` —— 同上 + 删 `getActiveProfile()`
- [ ] `types/electron-api.ts` —— `Conversation` 加 `modelSelection`
- [ ] `electron/main/agents/task-types.ts` —— 三个 Payload 字段替换

### 后端
- [ ] `electron/main/agents/agent-query-config.ts:101-186` —— 加 `resolveModelSelection`，重构 `buildQueryBaseConfig`
- [ ] `electron/main/agents/agent-worker.ts:560-840` —— 三个 handler 用统一 helper
- [ ] `electron/main/agents/query-based-session.ts:155/L1482-1493/L1771-1793` —— `setModel` 签名改 + 暴露 `pendingMessagesCount` + emit 事件
- [ ] `electron/main/agents/skills/chat-skill.ts:80/L176/L248-249` —— ChatSession 的 pendingMessages 同步暴露（如果有用户侧入口）
- [ ] `electron/main/tipc/agent.ts:344-357` —— `setSessionModel` 签名 + 加 status 接口
- [ ] `electron/main/tipc/digest.ts:62-102` —— 字段重命名（profileId+tier → modelSelection）
- [ ] `electron/main/tipc/review.ts:73-110` —— 同上
- [ ] `electron/main/tipc/category.ts:112-149` —— 同上
- [ ] `electron/main/tipc/renderer-handlers.ts` —— 加 `pendingCountChanged` 事件
- [ ] `electron/main/services/conversation-service.ts` —— 持久化 `modelSelection` 字段 + **`createConversation()` 创建时从 `settings.defaultModelSelection` 拷贝赋值**（关键：拷贝不是引用、null 也照拷）
- [ ] `electron/main/services/settings-service.ts` —— 检查 settings 加载/保存路径无需改逻辑（deepMerge 自动处理新字段）

### 前端
- [ ] `components/agent-chat/ChatInputArea.tsx:82-83/L340-385` —— 档位下拉改成按方案分组的二级菜单 + 去重 + null 占位
- [ ] `components/agent-chat/AgentChat.tsx` —— 把 `currentSelection` props 串下去，按钮状态读 `state` 而非 `isRunning`
- [ ] `components/agent-chat/hooks/useSendMessage.ts:447` —— 加 reconcile 逻辑 + 插话特例
- [ ] `components/agent-chat/hooks/useAgentSession.ts:26-27/L213` —— 订阅 `pendingCountChanged`，暴露 `pendingCount`
- [ ] `components/agent-chat/hooks/usePendingState.ts` —— 新建，派生三态
- [ ] `components/agent-chat/StreamingIndicator.tsx` —— flushing 态文案
- [ ] `components/agent-chat/usage-badge/useConversationUsage.ts:17` —— 读 1M context 时改成读对话当前 selection.profileId 对应的 profile
- [ ] `app/settings/page.tsx:73-83/L191-198/L331-333/L494-515` —— 删激活方案 UI，加 4 个模型选择器，子代理档位文案
- [ ] `stores/conversation-store.ts` —— 加 `setConversationModelSelection` action
- [ ] `stores/settings-store.ts` —— 字段同步（默认值/校验）
- [ ] `lib/client.ts` —— `setSessionModel` 签名

### 不动的部分
- `agent-manager.ts` —— Worker 池管理逻辑无关
- `tool-registry.ts` 和各 tool 文件 —— 工具注册不涉及模型
- 三个后台任务的 trigger 文件（`digest-trigger.ts` / `review-trigger.ts` / `category-trigger.ts`） —— 仍然只负责入队，模型由 worker handler 拿
- `wechat` / `stock` 服务 —— 与模型选择无关
- usage-badge 大部分组件 —— 只 hook 读 profile 那点改一行

### 文档
- [ ] `.claude/rules/codebase-map.md` —— 同步新结构（ModelSelection 类型出现位置、resolveModelSelection helper、三态派生 hook 等）
- [ ] `.claude/rules/agent-development.md` —— 如果有模型选择相关条目要更新

---

## 8. 迁移策略

CLAUDE.md 明确"开发阶段不做兼容性代码"：

1. **settings.json** 加载时若读到旧字段（activeProfileId / xxxModelTier / xxxProfileId）直接丢弃，新字段缺失走 DEFAULT_SETTINGS（即 null）
2. **conversations.json** 老条目没 `modelSelection` 字段就当 null，用户首次发消息时被门禁拦下，强制去选
3. **任务 payload** 的旧 `xxxModelTier` 字段直接删，trigger 不再传它
4. 不写 migration 脚本

---

## 9. 实施顺序建议

按依赖关系拆 5 步，每步可独立编译验证：

1. **数据层**：types + settings-types + task-types + DEFAULT_SETTINGS（仅类型，不改逻辑）
2. **后端 helper**：新增 `resolveModelSelection`，删 `getActiveProfile`，重构 `buildQueryBaseConfig`
3. **后端三任务统一**：digest / review / categorize handler 改用新 helper（同时改 tipc 接口）
4. **前端 UI**：ChatInputArea 二级菜单 + 设置页 4 个选择器 + null 门禁 + reconcile
5. **插话状态机**：后端 emit + IPC 事件 + 前端三态派生 + 按钮判定

每步完成后 `bun run build:electron && bun run lint` 验证。

---

## 10. 待办

- [ ] 用户拍板设计
- [ ] 用 `superpowers:writing-plans` 出实施计划
- [ ] 实施时按上述 5 步走，每步独立 commit
