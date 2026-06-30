# 子会话派遣（Phase 2）设计

> 上承：`docs/plans/2026-06/2026-06-24/conversation-group-design.md` 的 Phase 2 章节。
> Phase 1 会话组地基已落地（`groups.json` + `conversation.groupId/role` 字段 + 共享区物理目录 + 3 个共享区工具 + 组上下文注入）。

## 背景

主会话委派子任务并行执行、自己挂着审核汇总，是「复杂任务」场景的高频协作模式。SDK 的 subagent 是"主会话的延伸手臂"——共享上下文、阻塞、不可观察——不是"同事"。

Phase 2 要做的是把子会话做成 **first-class conversation**：独立 sdkSession、独立模型、独立账本、在列表里可见、可点入独立 tab、人能介入。主子之间靠**共享区文件**作为协作总线，靠**结构化交付**作为完成契约。

## 目标

- 主会话能用 9 个委派工具完成"派出去 → 跑完 → 拿回交付 → 汇总"的完整闭环
- 子会话是完整 conversation：列表可见、可独立 tab 打开、人能插话
- 不做嵌套（子会话不能再派孙会话）——通过**不注入 DelegateTo 系列工具**自然实现
- 默认零摩擦：子会话自动跑、权限自动通过、模型走全局默认
- 各种失败路径都有明确状态：`failed` / `timeout` / `no_delivery` / `cancelled`

## 架构

### 工具家族（9 个）

按"谁能调"分两类，注入时机由 `query-based-session.ts` 工具拼装阶段根据 `conversation.role` 控制。

**主会话独占（7 个，role='main' 才注入）**

| 工具 | 签名 | 行为 |
|---|---|---|
| `DelegateTo` | `(task: string, outputPath: string, title?: string)` | 同步：创建子 conversation + 启动子 QueryBasedSession，立即返回 `{ childId, outputPath, status:'running' }`。outputPath 占用校验（已存在的文件 / 同组 running 子会话已声明的路径）冲突即 reject。 |
| `DelegateBatch` | `(items: Array<{ task, outputPath, title? }>)` | 批量版，原子校验所有 outputPath 不冲突再一次性创建 N 个子会话。返回 `{ childIds: [...] }`。 |
| `WaitForDeliveries` | `(childIds: string[], timeoutMs?: number)` | **挂起在 tool handler**（await Promise）直到全部子会话进入 terminal 状态或超时。返回 `{ deliveries: [{ childId, status, outputPath, summary }] }`。timeoutMs 缺省走全局 `subAgentTimeoutMinutes`。 |
| `StopChild` | `(childId: string)` | abort 子会话 query 并标记 status:cancelled。已 terminal 的子会话调用是 no-op。 |
| `ListChildren` | `()` | 列出当前主会话派的所有子会话当前状态：`[{ childId, title, status, outputPath, startedAt, finishedAt? }]`。 |
| `SendMessageToChild` | `(childId: string, message: string)` | 给已 running 的子会话追加一条用户消息（push 到子会话 pendingMessages）。子会话 terminal 后调用 reject。 |
| `ReplyToChild` | `(childId: string, answer: string)` | 配合子会话 AskParent 用：resolve 子会话挂起的 AskParent Promise。bridge 校验该 childId 当前确实有 pending Ask。 |

**子会话独占（2 个，role='sub' 才注入）**

| 工具 | 签名 | 行为 |
|---|---|---|
| `SubmitDelivery` | `(summary: string, outputPath: string)` | 校验 outputPath 必须等于 DelegateTo 时声明的路径（防偷换），校验共享区该路径已经有内容（即子会话已经 WriteGroupFile 写过正文）。bridge 标记 status:done 并 resolve 主会话 WaitForDeliveries Promise。summary ≤1k token，由 zod 校验。 |
| `AskParent` | `(question: string)` | 工具内 await Promise，**同时** push 一条带 `[from child: <title>]` 标记的伪用户消息到主会话 pendingMessages。主会话 agent 调 ReplyToChild 后 resolve，工具结果是 `{ answer }`。 |

**注意**：子会话保留全部其他工具——`ReadGroupFile / WriteGroupFile / ListGroupFiles / Read / Grep / Bash / Skill / Task` 等等（继承主会话工具集，仅 swap 委派家族 + 加 SubmitDelivery/AskParent）。

### Spec 极简哲学

`DelegateTo` 只必填 `task + outputPath`（外加可选 `title`）。其他配置（model / persona / cwd / 工具集 / 权限模式）全部走默认继承或全局设置——**agent 不必、也不应该**在工具调用里指定。这降低 agent 心智负担，也避免 agent 瞎选模型。

要切子会话默认模型/权限模式，去**设置页** -> **派遣** Tab 改全局配置。

### delegation-bridge

新文件 `electron/main/agents/delegation-bridge.ts`，维护**所有进程内活跃子会话状态**：

```ts
interface ChildState {
  childId: string;            // = sub conversation.id
  parentConversationId: string;
  groupId: string;
  outputPath: string;
  title: string;
  status: 'running' | 'done' | 'failed' | 'timeout' | 'cancelled' | 'no_delivery';
  startedAt: number;
  finishedAt?: number;
  deliverySummary?: string;
  errorMessage?: string;
  abortController: AbortController;     // 喂给子会话 query
  askPending?: { resolve: (ans: string) => void; reject: (e: Error) => void };
}

// 主会话 waitFor 的挂起 Promise 一一对应一个 childId 集合
interface WaitState {
  parentConversationId: string;
  childIds: string[];
  resolve: (deliveries: DeliveryResult[]) => void;
  timer: NodeJS.Timeout;
}
```

核心方法：

- `startChild(parentConvId, spec)` → 创建子 conversation（role='sub', parentConversationId）+ 启动 QueryBasedSession + 注册 ChildState
- `submitDelivery(childId, summary, outputPath)` → 校验 + 写 ChildState + 解锁该 child 关联的所有 WaitState（all-done 时 resolve）
- `waitFor(parentConvId, childIds, timeoutMs)` → 返回 Promise，timeout 时把未完成的 mark 'timeout' 并 abort
- `stopChild(childId)` → 调 abortController 并 mark 'cancelled'
- `askParent(childId, question)` → push 主会话消息 + 返回挂起 Promise
- `replyToChild(childId, answer)` → resolve askPending

**重要不变量**：bridge 只维护内存状态，**子会话 conversation 本身的持久化**走原有的 `conversation-service`。重启 app 后 bridge 内存清空——所有 running 子会话从 conversation 列表角度看仍存在（role='sub' + finishedAt 未设），但 bridge 不会自动 resume；如果用户点进子会话独立 tab，按常规 conversation 走流程（用户可手动续聊）。Phase 2 不做"重启后自动续接子会话委派"。

### system prompt 增量

子会话启动时在原有 group context 之外**追加**：

```
## 你是子会话

主会话委派你执行任务：
{spec.task}

**交付契约（硬约束）**：
1. 你必须把详细产出 WriteGroupFile 到 `{outputPath}`
2. 完成后调 SubmitDelivery(summary, outputPath="{outputPath}")，summary ≤500 字
3. 遇到歧义不确定时调 AskParent(question) 反问主会话，不要瞎猜
4. 你**不能**派生子会话（这是规则约束，没有相关工具）
```

主会话不需要 system prompt 增量——委派工具的描述里已经讲清楚怎么用。

### UI 形态

**会话列表（ConversationList）**

- 子会话节点缩进 2 格出现在父会话节点下方，带连线
- 节点右侧角标：`⏳running` / `✓done` / `✗failed` / `⏱timeout` / `⊘cancelled` / `⚠no_delivery`
- 父会话节点带 `等 N 个交付` 角标（N = parentConvId 下 status=running 的子会话数）
- 子会话可点击进入独立 tab，UI 跟主会话完全相同（人能插话）

**主会话 chat 区**

- pendingState 增加流水化展示：`派遣中` / `等待交付（N 个 running，已完成 M）` / 复用现有 flushing 态
- 主会话挂在 WaitForDeliveries 时输入框下方出现 `🛑 中断等待` 按钮（不走 agent，直接调 IPC abort wait + 把 partial 结果丢回 tool result）

**子会话 chat 区**

- 顶部 banner：`来自主会话 [{父对话 title}] 的委派 · 交付路径 {outputPath}`
- 完成状态变化（done/failed 等）后 banner 显示对应徽章
- 权限请求 / AskParent 待回复时节点带 ⚠️ 角标

**SessionTab（顶部）**

- 子会话打开后跟主会话一样在顶部 tab 显示，title 前缀 `↪` 区分

## 模块边界

### 新增

- `electron/main/agents/delegation-bridge.ts` — 子会话生命周期 + Promise 挂起 + askParent 桥接
- `electron/main/agents/tools/delegation-tools.ts` — 7 个主会话工具的 MCP server（`dogear-delegation`）
- `electron/main/agents/tools/sub-agent-tools.ts` — 2 个子会话工具的 MCP server（`dogear-sub-agent`）
- `types/delegation.ts` — `ChildStatus / DeliveryResult / DelegateSpec` 等类型

### 修改

- `types/electron-api.ts` — `Conversation` 加 `parentConversationId?: string`（与 `parent_conversation_id` 区分：前者派生，后者分叉）
- `types/settings.ts` — `AppSettings` 加 `subAgent: { modelSelection?: ModelSelection; permissionMode?: PermissionMode; timeoutMinutes: number }`
- `electron/main/services/conversation-service.ts` — `create()` 接受 `parentConversationId / role` 参数；不在主索引中区分 main/sub，靠字段过滤
- `electron/main/agents/query-based-session.ts` — 工具注入阶段读 `conversation.role` 决定走主/子工具家族；子会话启动时拼 sub system prompt 增量
- `electron/main/agents/agent-query-config.ts` — 模型解析增加优先级层：`conv.modelSelection ?? settings.subAgent.modelSelection ?? settings.defaultModelSelection`（仅 role='sub' 时插中间层）
- `electron/main/agents/agent-worker.ts` — 不需要新 task type（CHAT_SESSION 复用），但子会话启动时由 delegation-bridge 拉起 worker 而不是 tipc/agent.ts
- `electron/main/tipc/agent.ts` — 新增 IPC：`abortWaitForDeliveries(conversationId)` 给「中断等待」按钮用；其他子会话操作复用现有的 CRUD
- `electron/main/tipc/renderer-handlers.ts` — 新事件：`childStatusChanged({ parentConvId, childId, status })`、`deliveriesAwaitChanged({ parentConvId, runningCount, doneCount })`
- `electron/main/services/group-shared-service.ts` — 新增 `claimOutputPath(workspaceId, groupId, relPath, childId)` / `releaseOutputPath(...)` 给 bridge 用，做"running 子会话路径占用"校验
- `app/settings/` — 新增「派遣」Tab 或并入「AI/模型」Tab：子会话默认模型 + 权限模式 + 超时
- `components/conversation-list/ConversationRow.tsx` + 列表骨架 — 渲染缩进 / 连线 / 状态角标 / 等 N 个交付角标
- `components/agent-chat/` — 主会话 ChatInputArea 加「中断等待」按钮；子会话顶部加 banner；pendingState 适配

## 数据流

### 派遣 + 等待（典型路径）

```
主会话 agent 调 DelegateTo(task="…", outputPath="subtask1.md")
  → delegation-bridge.startChild(parentConvId, spec)
    → conversation-service.create({ groupId, role:'sub', parentConversationId, title: spec.title ?? spec.task.slice(0,40) })
    → group-shared-service.claimOutputPath 占住路径
    → agent-manager.enqueueTask(CHAT_SESSION, { conversationId: childId, ... })
    → 注册 ChildState（status:'running'）
    → 广播 childStatusChanged
  → DelegateTo 工具立即返回 { childId, outputPath, status:'running' }

主会话 agent 接着调 WaitForDeliveries([childId], timeoutMs?)
  → bridge.waitFor → 返回 Promise，挂在 tool handler 内 await
  → 设置 timer（timeoutMs 或全局默认）

  (与此同时，子会话独立跑：)
  子会话 agent 用 ReadGroupFile/Read/Grep/Bash 等做研究
  → 调 WriteGroupFile(outputPath, detailContent)
  → 调 SubmitDelivery(summary, outputPath)
    → bridge.submitDelivery 校验 outputPath 一致性 + 共享区有内容
    → ChildState.status='done', deliverySummary=summary
    → 检查这个 childId 关联的所有 WaitState，若 all-done → resolve
    → 广播 childStatusChanged + deliveriesAwaitChanged

  → 主会话 WaitForDeliveries Promise resolve
  → 工具返回 { deliveries: [{ childId, status:'done', outputPath, summary }] }

主会话 agent 拿到结构化结果，可继续 ReadGroupFile 看详情、TodoWrite 总结等
```

### AskParent / ReplyToChild

```
子会话 agent 调 AskParent(question="X 用法 A 还是 B?")
  → bridge.askParent(childId, question) 返回 Promise（挂在工具内）
  → bridge push 伪用户消息到主会话 pendingMessages：
    "[from child: subtask1] X 用法 A 还是 B? (用 ReplyToChild 回答)"
  → 子会话工具调用一直 await

主会话 agent 处理这条 pendingMessage
  → 决定后调 ReplyToChild(childId, "用 A")
  → bridge.replyToChild 找到 askPending.resolve("用 A")
  → 子会话 AskParent 工具返回 { answer: "用 A" }
  → 子会话 agent 继续做事
```

### 用户在主会话 wait 期间插话

```
主会话状态：WaitForDeliveries 挂起中（pendingState='running'，因为 query() 还没返回）
用户在 ChatInputArea 输入 → 进 pendingMessages 队列
pendingState 派生为 'flushing'，StreamingIndicator 显示「队列还有 N 条插话待回复」
WaitForDeliveries Promise resolve → query() 继续 → 主会话回复完后处理 pending 队列里的用户消息
```

### 「中断等待」按钮

```
用户点 ChatInputArea 下方「🛑 中断等待」
  → tipc agent.abortWaitForDeliveries(conversationId)
  → bridge 找到该主会话的所有活跃 WaitState
  → 对每个 WaitState：把未完成的 child mark 'cancelled'（不 abort 子会话，只是让主会话不再等）
  → resolve WaitState Promise，deliveries 里未完成的 status='cancelled' + summary='主会话中断了等待'
  → 主会话 query 拿到结果继续
```

## 错误处理 / 边界情况

- **子会话 query() 抛错**：bridge 监听 worker error → status:'failed' + errorMessage → resolve 关联 WaitState（部分完成）
- **子会话 query 正常结束但未调 SubmitDelivery**：bridge 监听 worker 任务完成事件 → 若 status 仍是 'running' → mark 'no_delivery' → resolve WaitState（提示 agent 子会话没遵守契约，可自行重派或回报用户）
- **outputPath 冲突**：DelegateTo 校验 (a) 共享区文件已存在 OR (b) 同组 running 子会话已 claim 该路径 → 立即返回 isError:true，agent 自行换路径
- **app 重启时 running 子会话**：bridge 内存清空，子会话 conversation 仍在列表（status 视觉上凭借 finishedAt 是否为空判断），用户可手动点进去续聊；不做自动 resume
- **删除子会话/组**：子会话和主会话同样走 conversation 删除流程；删除组时联动删所有 conversation（含子）+ 共享区目录；bridge 监听删除事件清理 ChildState
- **WaitForDeliveries 收到的 childIds 中混了非自己派的**：bridge 校验 parentConvId 关系，不匹配的返回 isError
- **子会话权限模式 ≠ bypassPermissions 时弹权限请求**：复用现有 PermissionRequestCard，但只在子会话 tab 内显示；列表节点带 ⚠️ 角标提醒用户去处理
- **AskParent 永远不被回复**：跟着子会话超时（30min 默认）一起被清理：子会话被 abort + status:'timeout'，askPending reject
- **共享区路径释放**：子会话进入 terminal 状态后释放 claim；done 状态下文件仍保留在共享区供主会话读

## 不在 Phase 2 范围

- **嵌套**（子会话再派孙会话）—— 通过不注入工具实现，不需要额外校验代码
- **重启自动 resume**—— 用户可手动续聊
- **数字账本聚合到组级**—— digest/categorize/review 升级到组级是 Phase 3 范围
- **批量 StopAll**—— 用户真有需要可以一个一个 stop，或 Phase 2.5 加

## 未决问题（实施时补）

1. **SendMessageToChild 在子会话已经调 SubmitDelivery 之后但 wait 还没 resolve 的窗口**：算 running 还是 terminal？倾向算 terminal（reject），但要确认实际窗口长度
2. **DelegateBatch 部分失败语义**：N 个里有 1 个 outputPath 冲突，全部 reject 还是部分启动？倾向全部 reject 保持原子，agent 重新组装
3. **子会话工具集是否要去掉 Skill 调用**（避免子会话走 brainstorming/staged-impl 这种重流程）？倾向保留，让 agent 自己判断
4. **子会话 tab 关闭时的清理**：tab 关 ≠ 子会话停。tab 关后子会话继续跑直到 SubmitDelivery 或 timeout；用户重新打开 tab 能看到流。需要确认现有 SessionTab 关闭逻辑符合
5. **AskParent 时主会话已经离开 wait 状态**（比如手动中断了）：子会话 AskParent 还能正常 push 消息到主会话 pendingMessages，主会话 agent 下次响应时会处理，符合预期
