---
step: 2
title: 快照触发挂钩
status: pending
---

## 目标
agent 的 Write/Edit 成功后与 UI 文件操作后自动触发影子快照，安全网在线。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 的 `takeSnapshot(workspaceId, workspacePath, source, relPath?, conversationId?)` 签名
- 关键现状：`pi-session/builtin-tools.ts` 的 Write/Edit 是 pi-agent-core 工厂产物（createWriteTool/createEditTool），**无执行后钩子**——需包装 execute；工具组工厂 `createBuiltinFileTools(options)` 的 options 已有 conversationId 与 workspaceRoots
- UI 侧文件操作链路：`stores/workspace-store.ts` → tipc `explorer.ts` → `workspace-fs-service.ts` 的 createFolder/renameItem/deleteItem——注意 tipc 层只有 workspace.path，**没有 workspaceId**，需确认从 workspace 对象取 id 的现有字段
- 快照为异步不阻塞原操作；hasGit() 为 false 时静默跳过

## 计划改动
- [ ] `pi-session/builtin-tools.ts`：`createBuiltinFileTools` 内对 Write/Edit 包装——原 execute 返回后（成功分支）异步调 `takeSnapshot`，source 按 `agent-write`/`agent-edit`，relPath 取 args 的 file_path 相对工作区根；conversationId 从 options 取；workspaceRoots[0] 为工作区根（快照边界）
- [ ] `services/workspace-fs-service.ts`（或 tipc/explorer.ts 层，选不引入渲染层依赖的一侧）：createFolder/renameItem/deleteItem 成功后触发快照，source `ui-create`/`ui-rename`/`ui-delete`
- [ ] 验证：`bun run build:electron` 后跑 dev——agent 会话里 Edit 一个文件 → 影子仓库 `git log` 出现 `[snapshot] agent-edit`；文件树删除一个文件 → 出现 `[snapshot] ui-delete`；同一文件连续多次写不报 index.lock 冲突

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
