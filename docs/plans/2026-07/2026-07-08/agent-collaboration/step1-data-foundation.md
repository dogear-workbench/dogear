---
step: 1
title: 数据层地基
status: done
---

## 目标

给 `Conversation` 加 `contractMetadata` 字段，服务层支持读写，让现有 delegation-tools（`DelegateTo` 等）派出会话时自动写入。旧数据字段为空不影响加载。

## 依赖上下文（接力棒输入）

（首个 step，无依赖。执行时读 plan.md 的「全局决策」即可）

## 计划改动

### 类型定义

- [ ] `types/electron-api.ts` 加类型：
  ```ts
  interface ContractMetadata {
    parentSessionId: string;
    task: string;
    expectedOutputPath?: string;
    createdBy: 'agent' | 'human';
  }
  ```
- [ ] `Conversation` 接口加 `contractMetadata?: ContractMetadata`
- [ ] `electron/main/types.ts` 主进程镜像同步

### 服务层

- [ ] `electron/main/services/conversation-service.ts`：
  - `create()` 接受 `contractMetadata` 可选参数写入
  - `createFork()` 继承父对话的 `contractMetadata`（如果父有的话；fork 不产生新契约）
  - 新增 `getBySessionId(sdkSessionId: string): Conversation | null`——按 sdkSessionId 查（供 delegation-tools 反查派出者）
  - 序列化 / 反序列化对新字段透传（旧数据缺字段就是 undefined）

### Delegation Tools 内部写入

- [ ] `electron/main/agents/tools/delegation-tools.ts`：
  - `DelegateTo` 内部创建 conversation 时补上 `contractMetadata`：
    - `parentSessionId` = 调用方 session 的 sdkSessionId（当前工具执行上下文里的 session id）
    - `task` = 参数 `task`
    - `expectedOutputPath` = 参数 `outputPath`
    - `createdBy` = `'agent'`
  - `DelegateBatch` 同样处理
  - **注意**：这个 step 只做数据写入，工具语义不变（仍然是 DelegateTo/SendMessageToChild），Step 2 才做重构

### 会话运行时

- [ ] `electron/main/services/conversation-runtime-service.ts`：如果 delegation 走这里创建 session，确认 metadata 传递链路完整
- [ ] 手动创建对话的入口（`conversations.ts` tipc handler 的 `create`）不需要传 metadata，字段默认 undefined

## 验收标准

- [ ] TypeScript `bun run build:electron` 通过
- [ ] `bun run lint` 通过
- [ ] 手测：
  - 手动新建对话，`.dogear/conversations.json` 里该条无 `contractMetadata` 字段
  - Agent 通过 DelegateTo 派出子会话，`.dogear/conversations.json` 里新会话有 `contractMetadata`，字段完整
  - 打开旧的手动会话不报错

## 实施回填（做完后填）

### 实际改动

**改动文件清单**：
- `types/electron-api.ts` — 新增 `ContractMetadata` 接口；`Conversation` 加 `contractMetadata?` 字段
- `electron/main/services/conversation-service.ts` — 镜像 export `ContractMetadata`；`ConversationIndex` / `ConversationCompat` 加字段；`create()` options 加 `contractMetadata?`；`createFork()` 从父对话浅拷贝继承；新增 `getBySessionId()` 跨工作区查找；`toCompat()` 透传
- `electron/main/agents/delegation-bridge.ts` — `startChild()` 在父有 `sdkSessionId` 时组装 metadata 传给 create；父无 sdkSessionId 时跳过并 warn

**未改动（确认后跳过）**：
- `electron/main/agents/tools/delegation-tools.ts` — DelegateTo/DelegateBatch 都走 `bridge.startChild`，bridge 层已补，工具本身无独立创建路径
- `electron/main/services/conversation-runtime-service.ts` — `attachConversation` 只绑定已有 session，不独立 create
- `electron/main/tipc/conversations.ts` — 手动 create handler 默认 undefined，签名无需改
- `electron/main/types.ts` — 主进程原本就不镜像前端 `Conversation`，走独立 `ConversationIndex`，无需同步

**与计划差异**：
- `getBySessionId` 返回值调整为 `{ conv, workspaceId }`（对齐 `getByIdGlobal`），跨工作区查找必须带回 workspaceId 才能定位存储
- 父会话 `sdkSessionId` 为 null 时跳过写入而非传空串，避免产生语义无效的 `parentSessionId: ''`

### 给下一步的接力棒

**关键签名**：
```ts
// types/electron-api.ts + electron/main/services/conversation-service.ts（镜像 export）
export interface ContractMetadata {
  parentSessionId: string;
  task: string;
  expectedOutputPath?: string;
  createdBy: 'agent' | 'human';
}

// conversation-service.ts
export async function getBySessionId(
  sdkSessionId: string,
): Promise<{ conv: ConversationIndex; workspaceId: string } | null>

// conversation-service.ts — options 新增 contractMetadata
export async function create(
  workspaceId: string,
  groupId: string,
  title: string = '新对话',
  modelSelection: ModelSelection | null = null,
  options?: {
    role?: 'main' | 'sub';
    parentConversationId?: string;
    cachePolicy?: '5m' | '1h';
    contractMetadata?: ContractMetadata;
  },
): Promise<string>
```

**Step 2 该从哪里继续**：先读 `electron/main/agents/tools/delegation-tools.ts` + `electron/main/agents/delegation-bridge.ts` 熟悉现有 7 个工具语义，再规划新工具映射。契约通道校验用 `conversationService.getBySessionId()` 反查派出者。

**待办 / 已知限制**：
- 前端 IPC 层未暴露 `getBySessionId`。若 Step 4（溯源条）需前端直接查派出者，需在 `electron/main/tipc/conversations.ts` 补 procedure
- `ConversationCompat.contractMetadata` 直接透传 camelCase（字段名本就是 camelCase，无需转 snake_case）
