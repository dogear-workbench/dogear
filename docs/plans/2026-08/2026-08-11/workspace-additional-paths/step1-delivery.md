# Step 1 交付清单

## 状态：✅ 完成

## 改动文件（6 个）

### 1. `electron/main/agents/pi-session/workspace-boundary.ts`
- 新增 `resolveWithinPaths(roots: string[], candidatePath: string): Promise<string>`
  - 遍历 roots，对每个 root 做 `path.resolve` + `assertSyntacticallyWithin` + `assertNoSymlinkEscape` 两层校验
  - 命中任一根即返回；全部不命中抛 `路径越权` 错误
- `resolveWithinWorkspace(workspacePath, candidatePath)` 改为薄封装：调 `resolveWithinPaths([workspacePath], candidatePath)`
- 内部函数 `assertSyntacticallyWithin` 和 `assertNoSymlinkEscape` 保持不变

### 2. `electron/main/agents/pi-session/workspace-execution-env.ts`
- 构造参数：`workspacePath: string` → `allowedPaths: string[]`
- `this.cwd = allowedPaths[0]`，`NodeExecutionEnv` 的 cwd 也取 `allowedPaths[0]`
- `this.allowedPaths` 存为可变数组（`private allowedPaths: string[]`，非 readonly）
- `guard()` 改调 `resolveWithinPaths(this.allowedPaths, candidate)`
- 新增 `updateAllowedPaths(paths: string[]): void`

### 3. `electron/main/services/workspace-json-service.ts`
- 新增 `AdditionalPath` 接口（内部格式）：`{ path: string; enabled: boolean }`
- 新增 `AdditionalPathData` 接口（兼容格式）：`{ path: string; enabled: boolean }`
- `WorkspaceData` 加 `additionalPaths: AdditionalPath[]`
- `Workspace`（兼容接口）加 `additional_paths: AdditionalPathData[]`
- `toWorkspace()` / `toWorkspaceData()` 双向转换携带 additionalPaths，`?? []` 兜底
- `add()` 创建时 `additional_paths ?? []` 兜底

### 4. `types/electron-api.ts`
- 新增 `AdditionalPathData` 接口导出
- `Workspace` 接口加 `additional_paths: AdditionalPathData[]`

### 5. `electron/main/tipc/workspace.ts`
- 创建新工作区的对象字面量补 `additional_paths: []`

### 6. `electron/main/agents/pi-session/pi-session.ts`
- 调用点：`new WorkspaceExecutionEnv(this.config.workspacePath)` → `new WorkspaceExecutionEnv([this.config.workspacePath])`

## 编译验证
- `bun run build:electron` ✅ 零错误
- `bun run lint` ✅ 无新增错误

## 遗留 / 注意事项
- `resolveWithinWorkspace` 仍保留（search-tools.ts 在用），Step 2 切换后可删除
- `electron/main/types.ts` 无 Workspace 镜像类型，无需改动
- `tipc/workspace.ts` 中 spread `existing` 的路径自动继承 `additional_paths`，无需额外处理
- 旧 workspaces.json 数据无 `additionalPaths` 字段，读取时 `?? []` 兜底，兼容性 OK
