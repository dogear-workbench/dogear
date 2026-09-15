---
step: 1
title: 盘点与服务层路径切换
status: done
---

## 目标

notes 与 memory 的存储路径从 `<workspace>/.dogear/` 切到 `getConfigDir()/workspaces/{workspaceId}/` 下，服务层签名与全部调用点同步切换（本步不动存量数据，服务对新路径自动建目录）。

## 依赖上下文（接力棒输入）

- 设计决策：见 [plan.md 全局决策](./plan.md) 与 [设计文档](../app-data-layout-design.md)
- 现状锚点：
  - `electron/main/services/notes/notes-store.ts:23` `getNotesDir(workspacePath)` → `path.join(workspacePath, NOTES_DIR)`
  - `electron/main/services/memory/memory-fs.ts:16` → `path.join(workspacePath, '.dogear', 'memory')`
  - `memory-service.ts:6` 注释「不从全局读」已过时，需同步改
  - notes-service / memory-service 所有方法第一参数为 workspacePath

## 计划改动

- [x] 盘点 memory 附属路径全集：`memory-fs.ts` 全部导出函数、`state-card.ts`、`background-store.ts`、`session-paths.ts`、review-skill 相关，找齐所有 workspacePath 拼接点；topics-backup 类历史目录处理方式一并记录
- [x] 盘点 notes/memory 的全部调用方：`agents/tools/notes-tools.ts`、`agents/tools/memory-tools.ts`、tipc 层、前端 data-center、skill 文件（memory-review 等）中的硬编码路径或 workspacePath 透传
- [x] `notes-store.ts` / `memory-fs.ts`：路径函数改为 `workspaceId` 入参 → config 下新路径；需要 workspaceId → workspaces.json 反查的，用 `workspace-json-service` 既有能力
- [x] 调用链逐层改签名（service → tools → tipc → 前端 store），IPC 契约若含 workspacePath 参数则改为 workspaceId
- [x] `broadcastNotesChanged` 等事件携带的路径语义同步检查
- [x] `bun run build:electron` + 既有 smoke test 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无方向性差异。附属盘点结论：state-card.ts（纯数据层）、background-store.ts（已按 wsId 走 conversation-service.getWorkspaceDataDir）、session-paths.ts（会话 JSONL，与 notes/memory 无关）均无需改。路径实现复用既有模式（pi-session-repository 同款）：直接 `path.join(getConfigDir(), 'workspaces', workspaceId, ...)`，无需 workspaceId 反查 workspaces.json。migrate-notes-todos 迁移改为双参（todos.json 读旧工作区路径，notes 写新路径），既有测试改用 DOGEAR_CONFIG_DIR env 注入。TrashView/TaskPanel 属 tasks 域保持 workspacePath 契约不变。
- 改动文件清单：
  - 服务层：notes-store.ts / notes-service.ts（含 broadcastNotesChanged 载荷改 workspaceId）/ memory-fs.ts / memory-service.ts / memory-indexer.ts / memory-recall.ts / memory-loader.ts
  - IPC：tipc/notes.ts / tipc/memory.ts（input 改 workspaceId）/ tipc/renderer-handlers.ts（notesChanged 载荷改 workspaceId）
  - 工具：agents/tools/notes-tools.ts / memory-tools.ts / pi-session.ts（4 处调用点）/ scheduler/custom-agent-tools.ts
  - 迁移：migrate-notes-todos.ts（双参）/ migrate-notes-todos.test.ts（env 注入改写）
  - 前端：stores/notes-store.ts / stores/reference-store.ts（NoteReference.workspaceId）/ lib/reference-guard.ts / components/notes/{NotesPanel,NotesTimelinePane,NoteEditor,TrashView}.tsx / components/ToolBlock.tsx / components/agent-chat/tool-renderers/NoteCardRenderer.tsx / components/agent-chat/hooks/useSendMessage.ts（提示词模板 workspaceId 属性）/ app/data-center/{core-profile-panel,topics-panel,memory-section}.tsx / app/settings/ability/AbilityPackDetailPage.tsx / app/settings/AbilityTab.tsx
- 验证：build:electron 通过、tsc 前端全量通过、bun test 326 pass / 0 fail、lint 0 error

### 给下一步的接力棒
- 关键签名：`getNotesDir/getTrashDir/getIndexPath(workspaceId)` → `getConfigDir()/workspaces/{id}/notes[/​.trash|/index.json]`；`getMemoryDir/getCoreProfilePath/getTopicsDir/getTopicPath/getIndexPath(workspaceId)` → `getConfigDir()/workspaces/{id}/memory[/...]`；notes/memory 全链路（service→tools→tipc→前端）第一参数均为 workspaceId；notesChanged 载荷 `{ workspaceId }`
- 下个 step 从哪里继续：新建迁移模块（建议 electron/main/services/migrate-notes-memory.ts），遍历 workspace-json-service.getAll() 取 ws.path + ws.id，搬移后写 `getConfigDir()/workspaces/{id}/notes-memory-migrated.json`，接入点与 migrateTodosToNotesAllWorkspaces 同阶段（main-app.ts:768 附近）
- 待办或已知限制：无工作区会话（pi-session.ts:671 gate `!this.config.workspacePath`）仍注册 memory 工具，此时 workspaceId 为空串，路径落到 `workspaces/memory`（与旧版落 cwd 相对路径同性质，无人读写的角落）；迁移完成前旧目录数据不会被读取（本步无双读，存量用户升级后到 Step 2 迁移前会「空库」）
