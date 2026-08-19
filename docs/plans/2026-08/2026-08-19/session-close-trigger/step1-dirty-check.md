---
step: 1
title: triggerByConversation 补脏判定
status: pending
---

## 目标

让 `triggerByConversation` 只在目标组确实脏时入队提炼，成为可被调度器安全调用的精准触发入口。

## 依赖上下文（接力棒输入）

- 关键现状（本会话已调查）：
  - `electron/main/services/memory/group-digest-trigger.ts:267` `triggerByConversation(convId: string)`：`getByIdGlobal(convId)` 拿 `found.workspaceId` / `found.conv.groupId`，`getWorkspaceById` 拿 `ws.path` 后**直接 enqueue，无脏判定**（注释「触发点③：关会话后只扫该会话所属工作区/组」，当前无调用方，是死代码）
  - `electron/main/services/memory/group-digest-scanner.ts:123` `findDirtyGroup(wsId, wsPath, groupId, force)` → `DirtyGroup | null`；`force=true` 跳过脏判定（仅设置页手动重提炼用），本步骤用 `force=false`
  - `DirtyGroup` 结构含 `{ workspaceId, workspacePath, groupId, dirtyConversations }`（执行时核对字段名，`enqueue` 现有调用即示范）
- 设计动机：空闲会话关 tab（无新消息）时其组不脏，不该白跑一轮提炼；orphan 跑完销毁的场景 mtime 必然增长，组必脏，精准命中

## 计划改动

- [ ] `group-digest-trigger.ts:267` `triggerByConversation`：拿到 groupId/ws 后调 `findDirtyGroup(wsId, ws.path, groupId, false)`，返回 null 则直接 return；非 null 才 enqueue（enqueue 参数从 DirtyGroup 取，与 `triggerScanAll` 的入队方式对齐，注意保留 `dirtyConversations` 传递）
- [ ] 日志：不脏时 `mainLogger.info('[group-digest] 会话所属组不脏，跳过', convId)`；入队时带 groupId

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
