# 统一工具注册中心 实施计划

**目标**：消除工具元数据的重复定义，建立唯一的工具注册中心，设置页和 agent 从同一来源获取数据。同时清理 SDK 遗留死代码。

**架构思路**：注册中心存「server 分类 → 工厂引用」映射。设置页需要展示时调工厂提取 name/description（handler 不执行，传占位值安全）。工厂签名和实现完全不动。删除 registerTools 手写元数据 + toSdkServer / createXxxTools 死代码。

**涉及模块**：
- `agents/tools/tool-registry.ts` — 重写
- `agents/tools/*.ts`（13 个工具文件）— 删死代码 + 加注册
- `agents/pi/tool-adapter.ts` — 删 toSdkServer
- `tipc/agent.ts` — getRegisteredTools 改为遍历注册中心
- `agents/tool-pack-guide.ts` — mcp__ 前缀修正
- `services/stock-analysis-skills-service.ts` — mcp__ 前缀修正

## 步骤索引

- [ ] [Step 1: 重写注册中心](./step1-rewrite-registry.md) — 新的 ToolGroupRegistration + registerToolGroup + getAllToolGroups
- [ ] [Step 2: 改造工具文件](./step2-migrate-tools.md) — 13 个文件删死代码 + 加 registerToolGroup
- [ ] [Step 3: 改 IPC + 设置页数据流](./step3-fix-ipc.md) — getRegisteredTools 遍历注册中心
- [ ] [Step 4: 命名修正](./step4-fix-naming.md) — tool-pack-guide 和 skill 的 mcp__ 前缀

## 全局决策

### server = 分类标签，无运行时语义
pi 工具名是裸名（RecallMemory），不是 mcp__server__RecallMemory。server 字段只用于前端分组展示。

### 工厂签名不变
所有 createXxxToolDefs 函数签名和实现完全不动。注册中心只存工厂引用，消费者调用时传运行时参数。

### 占位值调工厂安全
设置页调工厂提取元数据时，带参数的工厂传占位值（空字符串/空对象）。handler 是异步函数定义，不调用就不执行，占位值不影响 ToolDef 对象结构。zod schema 是声明式的，构造阶段不做校验。

### 带参数工厂的占位值
| 工厂 | 占位值 |
|------|--------|
| createArticleToolDefs | `''` (workspacePath) |
| createMemoryToolDefs | `''` (workspacePath) |
| createReviewToolDefs | `''`, `''` (workspaceId, workspacePath) |
| createDigestToolDefs | `''`, `''` (workspaceId, workspacePath) |
| createGroupDigestToolDefs | 不注册到设置页（后台任务独占，参数太复杂） |
| createGroupToolDefs | `''`, `''` (workspaceId, groupId) |
| createDelegationToolDefs | `{ role: 'main', workspaceId: '', groupId: '', conversationId: '' }` |
| createReferenceToolDefs | `{ workspaceId: '', groupId: '', parentConversationId: '' }` |

### 不动的部分
- 工厂函数签名和实现
- pi-session 的装配逻辑
- agent-worker 的工具装配
- harness 原生工具（Read/Write/Edit/Bash）
- Skill 工具（动态生成）
- article-parse-tools.ts 的 SDK MCP server 实现（PARSE_ARTICLE 独立体系）
