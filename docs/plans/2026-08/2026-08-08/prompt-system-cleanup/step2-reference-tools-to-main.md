---
step: 2
title: 主会话注册 reference 工具
status: done
---

## 目标

让主会话也能直接读历史会话和组背景，不再强制通过派子会话中转。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 已删除 buildToolPackGuide，promptParts 中已无导览行
- 当前 reference 工具注册位置：`pi-session.ts:367-378`，条件是 `role === 'sub' && parentConversationId`
- `reference-tools.ts` 的 `createReferenceToolDefs(opts: ReferenceToolsOpts)` 需要 workspaceId / workspacePath / groupId / parentConversationId
- 主会话没有 parentConversationId（它不是被派出的），需要处理这个差异
- ListSiblingSessions 工具依赖 parentConversationId 来排除父会话——主会话场景下排除对象不存在，可跳过排除逻辑

## 计划改动

### 1. 调整 reference-tools.ts 的 opts 类型

- [ ] `ReferenceToolsOpts` 的 `parentConversationId` 改为可选（主会话没有父会话）
- [ ] `ListSiblingSessions` 实现中 `parentConversationId` 为空时跳过排除逻辑（主会话视角列所有同组非子会话）

### 2. 调整 pi-session.ts 注册条件

当前（约 line 367-378）：
```typescript
if (this.config.role === 'sub' && this.config.parentConversationId) {
  toolDefs.push(...registerPack('dogear-reference', createReferenceToolDefs({...})));
}
```

改为：有 groupId 时主会话和子会话都注册：
```typescript
if (this.config.groupId) {
  toolDefs.push(...registerPack('dogear-reference', createReferenceToolDefs({
    workspaceId: this.config.workspaceId,
    workspacePath: this.config.workspacePath,
    groupId: this.config.groupId,
    parentConversationId: this.config.parentConversationId,  // 主会话为 undefined
  })));
}
```

### 3. 验证

- `bun run build:electron` 编译通过
- 确认主会话启动时 reference 工具已注册（有 groupId 的场景）
- 确认子会话行为不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无差异，完全按计划执行
- 改动文件清单：
  1. `electron/main/agents/tools/reference-tools.ts`：`parentConversationId` 改为可选，ListSiblingSessions 无值时跳过排除逻辑，文件头注释更新
  2. `electron/main/agents/pi-session/pi-session.ts`：注册条件从 `role==='sub' && parentConversationId` 改为 `groupId` 存在

### 给下一步的接力棒
- 关键签名 / 数据结构：`createReferenceToolDefs` 签名为 `{ workspaceId, workspacePath, groupId, parentConversationId? }`
- 下个 step 该从哪里继续：`session-append-templates.ts` 的 REFERENCE_APPEND / groupAppendFor / MAIN_AGENT_DELEGATION_APPEND / subAgentContractFor 全部待重写
- 待办或已知限制：无
