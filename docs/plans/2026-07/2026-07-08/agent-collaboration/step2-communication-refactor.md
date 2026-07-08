---
step: 2
title: 通信 API 重构 + 契约通道校验
status: pending
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

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 新工具的完整入参 / 出参签名（Step 4/5 UI 层可能引用）
  - `hasContractChannel` 的具体位置和签名
- Step 3/4/5 该从哪里继续：Step 3 完全独立可以并行，Step 4/5 关注前端 UI，可以从这里开始
- 待办或已知限制：
  - `.claude/` 下文档提示词的更新是否已手动完成？
