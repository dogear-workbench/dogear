# Step 2 交付清单

## 状态：✅ 完成

## 改动文件（6 个）

### 1. `electron/main/agents/pi-session/pi-session.ts`
- `PiSessionConfig` 新增 `additionalPaths: string[]` 字段（已过滤 enabled 的绝对路径数组）
- 新增 `private env: WorkspaceExecutionEnv | null` 字段，`start()` 内赋值
- `start()` 创建 env：`new WorkspaceExecutionEnv([this.config.workspacePath, ...this.config.additionalPaths])`
- 新增 `getWorkspaceId(): string` 方法（供 PiSessionManager 按 workspaceId 过滤）
- 新增 `updateWorkspacePaths(additionalPaths: string[]): void` 方法——更新 config.additionalPaths 并调 `this.env?.updateAllowedPaths([primary, ...additionalPaths])`
- `buildMainAgentToolDefs` 和 `buildSubAgentToolDefs` 中 `createSearchToolDefs` 调用改为传 `[workspacePath, ...additionalPaths]`

### 2. `electron/main/agents/pi-session/pi-session-manager.ts`
- 新增 `updateWorkspacePaths(workspaceId: string, enabledPaths: string[]): void`
  - 遍历所有活跃 PiSession，匹配 `workspaceId` 后调 `session.updateWorkspacePaths(enabledPaths)`
  - 幂等：每次调用全量覆盖 allowedPaths

### 3. `electron/main/agents/pi-session/search-tools.ts`
- 函数签名：`createSearchToolDefs(workspacePath: string)` → `createSearchToolDefs(allowedPaths: string[])`
- import：`resolveWithinWorkspace` → `resolveWithinPaths`
- `walkFiles` 参数从 `workspacePath` 改为 `rootPath`（语义不变，相对基准为遍历根目录）
- 新增 `FileEntry` 接口（`{ display: string; abs: string }`）和 `collectFiles()` 辅助函数
- Glob/Grep 工具适配多路径：
  - 无 subPath 时遍历所有 allowedPaths（primary 给相对路径，extras 给绝对路径）
  - 有 subPath 时 `resolveWithinPaths(allowedPaths, subPath)` 解析到具体根目录，仅遍历该根
  - Grep 文件读取用 `entry.abs`（始终绝对路径），输出用 `entry.display`
- 删除旧代码中对 `resolveWithinWorkspace` 和 `workspacePath` 变量的所有引用

### 4. `electron/main/services/conversation-runtime-service.ts`
- `createSession` config 新增 `additionalPaths`：从 `workspace.additional_paths` 过滤 `enabled` 后取 `path`
  ```typescript
  additionalPaths: (workspace?.additional_paths ?? []).filter((p) => p.enabled).map((p) => p.path),
  ```

### 5. `electron/main/tipc/workspace.ts`
- import `getPiSessionManager` 和 `Workspace` 类型
- 新增辅助函数 `hotUpdateAdditionalPaths(workspaceId, workspace)`：提取 enabled paths → 调 `getPiSessionManager().updateWorkspacePaths()`
- 新增 3 个 IPC procedure：
  - `addAdditionalPath({ workspaceId, path })`：push（默认 enabled=true）→ 写盘 → 热更新
  - `removeAdditionalPath({ workspaceId, path })`：过滤移除 → 写盘 → 热更新
  - `toggleAdditionalPath({ workspaceId, path, enabled })`：修改 enabled → 写盘 → 热更新

### 6. `electron/main/services/workspace-json-service.ts`
- 新增 `update(id: string, ws: Workspace): Promise<void>`：全量覆盖写入工作区数据

## 不需要改动
- `lib/client.ts`：`createClient<Router>()` 自动暴露新 procedure，零改动
- `types/electron-api.ts`：Step 1 已添加 `additional_paths` 字段
- `workspace-boundary.ts`：`resolveWithinWorkspace` 保留（无人再用，但删除不属于本期范围）

## 编译验证
- `bun run build:electron` ✅ 零错误
- `bun run lint` ✅ 无新增错误

## 给下一步的接力棒
- 前端可直接用 `client.addAdditionalPath` / `client.removeAdditionalPath` / `client.toggleAdditionalPath` 调用，返回 `{ success, workspace?, error? }`
- IPC 返回的 `workspace` 对象已包含更新后的 `additional_paths` 数组，前端可直接刷新本地状态
- `PiSession.updateWorkspacePaths()` 是幂等的，可安全重复调用
- 搜索工具对附加路径返回绝对路径，主路径返回相对路径——Step 3+ 的 UI 文件树组件需注意这个区别
