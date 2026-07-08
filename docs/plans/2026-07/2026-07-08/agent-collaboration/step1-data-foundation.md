---
step: 1
title: 数据层地基
status: pending
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
- 与计划差异：（新发现的边界、调整的设计）
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `Conversation.contractMetadata` 的具体 TS 类型（Step 2/3/4/5 都要用）
  - `getBySessionId` 的具体签名（Step 2 契约通道校验要用）
- Step 2 该从哪里继续：先读 delegation-tools 现有工具清单，然后重构
- 待办或已知限制：
