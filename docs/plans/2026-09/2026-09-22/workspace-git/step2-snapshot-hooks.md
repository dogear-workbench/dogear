---
step: 2
title: 快照触发挂钩
status: done
---

## 目标
agent 的 Write/Edit 成功后与 UI 文件操作后自动触发影子快照，安全网在线。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1 的 `takeSnapshot(workspaceId, workspacePath, source, relPath?, conversationId?)` 签名
- 关键现状：`pi-session/builtin-tools.ts` 的 Write/Edit 是 pi-agent-core 工厂产物（createWriteTool/createEditTool），**无执行后钩子**——需包装 execute；工具组工厂 `createBuiltinFileTools(options)` 的 options 已有 conversationId 与 workspaceRoots
- UI 侧文件操作链路：`stores/workspace-store.ts` → tipc `explorer.ts` → `workspace-fs-service.ts` 的 createFolder/renameItem/deleteItem——注意 tipc 层只有 workspace.path，**没有 workspaceId**，需确认从 workspace 对象取 id 的现有字段
- 快照为异步不阻塞原操作；hasGit() 为 false 时静默跳过

## 计划改动
- [x] `pi-session/builtin-tools.ts`：`createBuiltinFileTools` 内对 Write/Edit 包装——原 execute 返回后（成功分支）异步调 `takeSnapshot`，source 按 `agent-write`/`agent-edit`，relPath 取 args 的 file_path 相对工作区根；conversationId 从 options 取；workspaceRoots[0] 为工作区根（快照边界）
- [x] `services/workspace-fs-service.ts`（或 tipc/explorer.ts 层，选不引入渲染层依赖的一侧）：createFolder/renameItem/deleteItem 成功后触发快照，source `ui-create`/`ui-rename`/`ui-delete`
- [x] 验证：`bun run build:electron` 后跑 dev——agent 会话里 Edit 一个文件 → 影子仓库 `git log` 出现 `[snapshot] agent-edit`；文件树删除一个文件 → 出现 `[snapshot] ui-delete`；同一文件连续多次写不报 index.lock 冲突

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - UI 挂钩层选在 **workspace-fs-service.ts**（非 tipc/explorer.ts）：设计文档明确「挂钩点在主进程文件服务层，不在渲染层」；service 层无 electron 依赖可被脚本直测；签名加可选尾参 `workspaceId?`，向后兼容既有调用方，tipc/explorer.ts 五处传入 `input.workspaceId` 即可（tipc 入参本就有 workspaceId，无需反查）
  - moveItem/copyItem 也挂钩（计划只列 createFolder/renameItem/deleteItem）：move → `ui-rename`、copy → `ui-create`，操作语义与安全网覆盖一致
  - articleService 分支（.dogear/articles）不挂钩：影子仓库 ignore 规则排除 `.dogear/`，挂了也不会产生提交
  - agent Write/Edit 仅在写入落主根（workspaceRoots[0]，即影子 work-tree 边界）内时快照；附加根路径跳过（进不了影子仓库）
- 改动文件清单：
  - `electron/main/services/workspace-fs-service.ts`：新增 `snapshotAfterUi` helper（fire-and-forget + catch console.warn）；createFolder/renameItem/moveItem/copyItem/deleteItem 加 `workspaceId?: string` 尾参，成功后触发快照
  - `electron/main/agents/pi-session/builtin-tools.ts`：`BuiltinFileToolsOptions` 加 `workspaceId?`；`withSnapshot()` 包装 createWriteTool/createEditTool 产物（原 execute 成功返回后才触发快照，失败/中断不触发）；`snapshotAfterAgentMutation()` 计算 relPath 并调 takeSnapshot
  - `electron/main/agents/pi-session/pi-session.ts`：createBuiltinFileTools 传入 `workspaceId: this.config.workspaceId`
  - `electron/main/tipc/explorer.ts`：五个文件操作路由传 `input.workspaceId`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `workspace-fs-service.ts` 五个写操作签名变为 `(workspacePath, ..., workspaceId?: string)`；不传 workspaceId 则不打快照（向后兼容）
  - 快照触发均为 fire-and-forget（`.catch(console.warn)`），无 git 时 takeSnapshot 静默跳过，不影响原操作
- 下个 step 该从哪里继续：step3 工具层（`agents/tools/git-tools.ts`），消费 git-service 的 listShadowHistory/restoreFromSnapshot/用户仓库函数；工具在检查影子仓库时应容忍空仓库（无提交）
- 待办或已知限制：
  - **密集快照合并**：takeSnapshot 是 add -A 全量收集 + hasStagedChanges 滤空提交，连续快速操作可能合并为一次提交（message 记首个触发源），UI 展示时不应假设「一操作一提交」
  - **空目录操作不产生提交**（git 不跟踪空目录）：createFolder 空目录无快照，目录内写入文件时被后续快照自然带上
  - 附加根（enabled extra roots）内的 agent 写入不打快照（影子 work-tree 仅主根）
  - 验证脚本留存于 `tmp/verify-step2.test.ts`（git ignored，`bun test tmp/verify-step2.test.ts`）
