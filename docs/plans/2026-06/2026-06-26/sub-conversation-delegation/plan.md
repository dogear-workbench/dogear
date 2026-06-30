# 子会话派遣 Phase 2 实施计划

**目标**：把会话组的子会话委派能力做出来——主会话能用 9 个委派工具完成「派出去 → 跑完 → 拿回交付 → 汇总」闭环，子会话在列表里可见、可点入独立 tab、人能介入。

**架构思路**：
- 子会话 = first-class conversation（复用现有 conversation-service + agent-manager + QueryBasedSession），不引入新运行模式
- delegation-bridge 维护内存活跃子会话状态机 + Promise 挂起池
- 工具家族按 `conversation.role` 分流注入（main/sub 各拿不同工具集）
- 不嵌套：通过「子会话不注入 DelegateTo 系列」自然约束，无需校验代码

**设计依据**：`docs/plans/2026-06/2026-06-26/sub-conversation-delegation-design.md`

**涉及模块**：
- 新增：`delegation-bridge.ts` / `delegation-tools.ts` / `sub-agent-tools.ts` / `types/delegation.ts`
- 修改：`conversation-service.ts`（create 支持 role/parent）/ `agent-query-config.ts`（subAgent fallback 层）/ `query-based-session.ts`（按 role 注入工具 + sub system prompt）/ `group-shared-service.ts`（outputPath claim 表）/ `settings-types.ts`（subAgent 配置）/ `tipc/agent.ts`（abortWait IPC）/ `renderer-handlers.ts`（child 事件）/ `ConversationRow.tsx`（子会话渲染）/ `agent-chat/`（中断按钮 + banner + pendingState）/ 设置页

## 步骤索引

- [x] [Step 1: 数据基础 + 类型](./step1-foundation.md) — settings 加 subAgent 配置、conversation.create 支持 role/parent、outputPath claim 表、types/delegation.ts
- [x] [Step 2: delegation-bridge 骨架](./step2-bridge.md) — ChildState/WaitState 状态机 + 6 个核心方法 + 子会话拉起接 agent-manager + agent-query-config 加 subAgent fallback
- [x] [Step 3: 核心闭环（3 工具）](./step3-core-loop.md) — DelegateTo + SubmitDelivery + WaitForDeliveries 工具实现 + role-based 工具注入 + sub system prompt
- [x] [Step 4: 主会话管理工具（4 工具）](./step4-mgmt-tools.md) — StopChild + ListChildren + SendMessageToChild + DelegateBatch
- [x] [Step 5: 反向通信（2 工具）](./step5-ask-reply.md) — AskParent + ReplyToChild + bridge.askParent/replyToChild
- [x] [Step 6: 列表 UI 可视化](./step6-list-ui.md) — ConversationRow 缩进 + 状态角标 + 父会话「等 N 个交付」+ 事件订阅 + 子会话可点入独立 tab
- [x] [Step 7: chat 区适配](./step7-chat-ui.md) — 中断等待按钮 + abortWait IPC + 子会话顶部 banner + pendingState wait 态识别
- [x] [Step 8: 设置页派遣配置](./step8-settings.md) — subAgent.modelSelection / permissionMode / timeoutMinutes UI

## 全局决策

### 数据模型
- **不新加 parentConversationId 字段**：复用现有的（原本只给分叉用）。`role='sub' + forkMessageSdkUuid=null` 即为派生子会话；`role='main' + forkMessageSdkUuid 非空` 即为分叉
- **bridge 内存状态不持久化**：app 重启时所有 running 子会话从 bridge 视角清空。子会话 conversation 本身仍存在，用户可手动点 tab 续聊
- **outputPath claim 表**：仅内存，进程级唯一性。重启后自动释放（设计上 done 子会话的文件本来就在共享区，不存在"占着不放"的问题）

### 命名约定
- 工具 MCP server 名：主会话工具集 `dogear-delegation`，子会话工具集 `dogear-sub-agent`
- 工具名严格按设计文档（DelegateTo / DelegateBatch / WaitForDeliveries / StopChild / ListChildren / SendMessageToChild / ReplyToChild / SubmitDelivery / AskParent）
- 设置字段：`AppSettings.subAgent = { modelSelection?, permissionMode?, timeoutMinutes }`，缺省 timeoutMinutes=30
- IPC 事件：`childStatusChanged({ parentConversationId, childId, status })`、`deliveriesAwaitChanged({ parentConversationId, runningCount, doneCount })`

### 子会话默认行为
- **权限模式**：`bypassPermissions`（设置可改）
- **模型**：`conv.modelSelection ?? settings.subAgent.modelSelection ?? settings.defaultModelSelection`（在 resolveModelSelection 入口前组装好 fallback chain，不污染主会话路径）
- **工具集**：继承主会话工具集 — `dogear-delegation` MCP server + `bypassPermissions` 关联工具；其余照搬
- **system prompt**：原 group context 之上追加 sub-agent 增量段（task / outputPath / 交付契约）
- **cachePolicy**：从父会话继承（一并 fork 缓存策略，避免每个子会话重复构建 prefix cache）

### 错误处理统一
- 工具内部错误 → `{ content: [...], isError: true }`，不抛
- 业务错误（outputPath 冲突 / 未指定模型 / 子会话不属于自己）→ tool result 里说清楚原因，agent 可读
- bridge 内部异常用 mainLogger.child('delegation-bridge') 记录，绝不让 Promise hang 死

### 验证基线
每步必须满足：
- `bun run build:electron` 成功
- `bun run lint` 通过（零新增 warning）
- 至少一条"手测路径"明确写在 step 文档里

### 文档接力
- 每步做完在 step 文档「实施回填」节写：实际改动列表、关键签名/数据结构、给下一步的注意事项
- 在本 plan.md 把对应 `[ ]` 改 `[x]`
- 改动跟设计文档有偏差时回写 design.md 或在 step 文档注明
