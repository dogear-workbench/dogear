---
step: 2
title: 通信 API 重构 + 契约通道校验
status: done
---

## 目标

把 delegation-tools 从"父子专用工具"重构为"通用会话操作工具"，语义体现 agent 之间的平等协作；同时在服务层加契约通道校验，非派出关系的会话不能互发消息。

## 依赖上下文（接力棒输入）

- **Step 1 产出**：
  - `Conversation.contractMetadata` 字段可用
  - `conversation-service.getBySessionId(sdkSessionId)` 可反查派出者
  - DelegateTo 派出的会话已经写入了 metadata

- **关键决策回顾**：
  - 老工具**全部替换**为新语义，不保留兼容层（用户明确选了重构方向）
  - 校验放**服务层**，不在 IPC 层，确保任何路径都被拦

## 计划改动

### 新工具设计

替换清单（老 → 新）：

| 旧工具 | 新工具 | 说明 |
|---|---|---|
| `DelegateTo` | `CreateSession` | 参数一致（task/outputPath/title），语义为"创建平级新会话 + 建立契约通道 + 发送 initial message" |
| `DelegateBatch` | `CreateSessionBatch` | 批量版本 |
| `SendMessageToChild` | `SendMessage` | 参数 `toSessionId + message`，走契约通道校验 |
| `ReplyToChild` | 合并进 `SendMessage` | 挂起时的反问回复就是普通发消息（agent 那边等消息即可） |
| `SubmitDelivery` | `SendMessage` + 约定标记 | 交付本质是"发消息给派出者说完了"，可加 `metadata: { delivery: true }` 语义糖 |
| `WaitForDeliveries` | `WaitForMessage` | 等来自指定 sessionId 的消息（更通用） |
| `ListChildren` | `ListLinkedSessions` | 列出与当前会话有契约通道的所有会话 |
| `StopChild` | `StopSession` | 停止指定会话 |

### 契约通道校验

- [ ] 服务层新增纯函数 `hasContractChannel(fromSessionId: string, toSessionId: string): boolean`：
  - 查 conversation-service：拿 from 和 to 两个 conversation
  - 检查是否存在派出关系（直接或递归）：
    - `to.contractMetadata?.parentSessionId === from.sdkSessionId`（from 派出了 to）
    - `from.contractMetadata?.parentSessionId === to.sdkSessionId`（to 派出了 from）
  - **只有直接派出关系有通道**（递归通道不允许——A 派 B 派 C，A 不能直接给 C 发消息，得走 B 转）
  - 返回 boolean

- [ ] `SendMessage` 内部调用 `hasContractChannel` 校验，失败返回明确错误："当前会话与目标会话之间无契约通道，无法直接通信"

### 工具实现

- [ ] `electron/main/agents/tools/delegation-tools.ts`：
  - 删除老工具定义
  - 实现新工具（参照上表）
  - 提示词（工具 description）改为平等协作视角，例：
    - `CreateSession`: "创建一个平级的新会话来协作处理任务。新会话与当前会话建立契约通道，可通过 SendMessage 双向通信。"
    - `SendMessage`: "向已建立契约通道的会话发送消息。目标会话必须与当前会话有直接派出关系（当前派出或被派出）。"

- [ ] MCP server 名字可以从 `dogear-delegation` 改为 `dogear-session-ops`（更贴合新语义），或者保留（避免动配置文件）——由实施时按代价定

### 调用点/提示词更新

- [ ] 全项目搜索老工具名字（DelegateTo / SendMessageToChild 等），把出现在提示词/skill 文档/说明里的都改成新名
  - `.claude/skills/**/*.md` 里如果有出现
  - `CLAUDE.md` 里如果有出现
  - `electron/main/agents/session-append-templates.ts` 里的系统提示词模板
  - agent-worker 里如果有硬编码引用

**注意（feedback：子会话不碰 .claude/）**：`.claude/` 目录下的文档改动**留给主会话手动做**，不要在子会话里改。子会话只改 electron/ 和 src/ 下的代码。

### 迁移辅助

- [ ] 无 — 不迁移旧数据（全局决策）

## 验收标准

- [ ] TypeScript `bun run build:electron` 通过
- [ ] `bun run lint` 通过
- [ ] 手测：
  - Agent 用 `CreateSession` 派出新会话，新会话正常创建
  - Agent 用 `SendMessage` 给派出的会话发消息，能到达
  - 手动构造两个无契约关系的会话，`SendMessage` 返回错误
  - `ListLinkedSessions` 返回当前会话的派出方 + 派出对象
- [ ] 老工具名字在项目里应该全部消失（.claude/ 下的除外，那部分主会话手动处理）

## 实施回填（做完后填）

### 架构决策落地

采用**方案 A（彻底统一）**：`dogear-sub-agent` MCP server 删除，改用 `dogear-delegation` 挂两套工具子集（工具子集控制防孙子而非 server 分流）：
- 主会话工具集：`CreateSession` / `CreateSessionBatch` / `SendMessage` / `WaitForMessage` / `ListLinkedSessions` / `StopSession`
- 子会话工具集：`SendMessage` / `WaitForMessage` / `ListLinkedSessions`（无 Create*/Stop）

delegation-bridge 内部**保守化**：保留 childStates 状态机、`startChild`/`stopChild`/`getChildrenByParent`/`getChildSnapshot`/`abortWaitsForParent`（签名与广播事件契约不变）。新增：`messageWaiters` 通用消息等待池、`sdkSessionIdWaiters`（等异步 session_init）、`markChildDelivered`、`getChildIdBySessionId`/`getParentSessionIdByChildConversationId` 反查 helper。移除：`askPending`/`askParent`/`replyToChild`/`sendMessageToChild`/`submitDelivery`/旧 `waitFor`+`waitStates`。

### 实际改动

**改动文件清单**：
- `electron/main/services/contract-channel-service.ts` — **新建**，`hasDirectContractChannel(fromSessionId, toSessionId)` 只认直接派出关系
- `electron/main/agents/tools/delegation-tools.ts` — 全面重写，6 个新工具 + role 参数控制子集
- `electron/main/agents/tools/sub-agent-tools.ts` — **删除**
- `electron/main/agents/delegation-bridge.ts` — 见上「架构决策落地」
- `electron/main/agents/query-based-session.ts` — `createDelegationTools({ role: 'main' \| 'sub', ... })` 挂载分流
- `electron/main/agents/session-append-templates.ts` — `subAgentContractFor` / `REFERENCE_APPEND` / `groupAppendFor` 三段提示词重写
- `electron/main/agents/tools/reference-tools.ts` — 注释 DelegateTo → CreateSession
- `electron/main/agents/tools/tool-registry.ts` — `SERVER_LABELS` 加 `dogear-delegation` / `dogear-reference` 标签
- `electron/main/services/conversation-runtime-service.ts` — 移除 `mcp__dogear-sub-agent__*` 白名单
- `electron/main/services/group-shared-service.ts` — 注释更新
- `electron/main/tipc/delegation.ts` — 仅改注释；IPC procedure 名保留向后兼容
- `electron/main/types.ts` / `types/delegation.ts` — 移除 `DeliveryResult`；`ChildStateSnapshot` 加 `sdkSessionId?`
- `app/settings/SubAgentTab.tsx` — 文案 DelegateTo → CreateSession
- `.claude/rules/codebase-map.md` — 主会话更新（delegation-tools 段 + 组提炼链路两处 SubmitDelivery）
- `.claude/skills/staged-execution/SKILL.md` — 主会话更新（10+ 处旧工具名替换）

**与计划差异**（3 处）：
1. `WaitForMessage` 不按 delivery 过滤（否则 AskParent 替代流程的普通回复无法唤醒）。取第一条到达消息返回，delivery 只作为消息标记字段用于文案区分和 no_delivery 判定
2. `SendMessage(delivery:true)` 不再校验交付物文件已写入（旧 SubmitDelivery 会读 outputPath 校验非空）
3. `CreateSession` 需异步等子会话 sdkSessionId 就绪（session_init 事件），bridge 层新增 `waitForChildSdkSessionId()` 默认 15s 超时，超时未就绪时提示改用 ListLinkedSessions 补查

`StopSession` 契约校验比通用 `hasDirectContractChannel` 更严——仅允许停自己派出的对象（`target.contractMetadata.parentSessionId === 自己的sdkSessionId`），双重保险。

### 给下一步的接力棒

**关键签名**：
```ts
// 服务层
export async function hasDirectContractChannel(
  fromSessionId: string,
  toSessionId: string,
): Promise<boolean>

// createDelegationTools opts（判别联合）
type DelegationToolsOpts =
  | { role: 'main'; workspaceId; groupId; conversationId }
  | { role: 'sub'; workspaceId; groupId; conversationId; parentConversationId }
```

前端 IPC 层保持向后兼容：`abortWaitForDeliveries` 等 procedure 名未改，但**内部语义变宽**——原来只取消被显式等待的子会话，现在会取消该父名下所有 running 子会话 + resolve(null) 所有 messageWaiters。

**Step 3/4/5 接入点**：
- Step 3（排序 + 图标）完全独立，可以并行；已有 `Conversation.contractMetadata`（Step 1）+ `ChildStateSnapshot.sdkSessionId`（Step 2 新增）即够
- Step 4（溯源条 + Tab 静默启动）：前端可用 `contractMetadata.parentSessionId` 反查派出者；若要显式 IPC 查询，Step 1 遗留的 `getBySessionId` IPC 封装可在此补
- Step 5（消息 sender）：agent 消息可用 `sender: { type: 'agent', sessionId }`；sessionId 就是 `ChildStateSnapshot.sdkSessionId`

**待办 / 已知限制**：
- `docs/plans/` 下历史档案保留旧工具名不改（历史决策记录）
- `.claude/` 更新已完成（本 step 收尾时主会话手动改）
