---
step: 1
title: 数据模型 + 边界机制
status: done
---

## 目标

Workspace 数据模型加 `additionalPaths` 字段；边界校验从单根改为多根；`WorkspaceExecutionEnv` 的 `allowedPaths` 改为可变数组并暴露热更新方法。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-11/workspace-additional-paths-design.md`
- 当前 `resolveWithinWorkspace(workspacePath: string, candidatePath: string)` 在 `electron/main/agents/pi-session/workspace-boundary.ts`，做两层校验：`assertSyntacticallyWithin`（path.relative 前缀）+ `assertNoSymlinkEscape`（realpath 向上探测）
- `WorkspaceExecutionEnv` 在 `electron/main/agents/pi-session/workspace-execution-env.ts`，构造参数是 `workspacePath: string`，`guard(candidate)` 调 `resolveWithinWorkspace`
- `WorkspaceData` 在 `electron/main/services/workspace-json-service.ts:19`，`Workspace` 兼容格式在同文件 `:34`，前端镜像在 `types/electron-api.ts:15`

## 计划改动

### 1.1 数据模型

- [ ] `electron/main/services/workspace-json-service.ts`
  - 新增 `AdditionalPath` 接口（内部格式）：`{ path: string; enabled: boolean }`
  - 新增 `AdditionalPathData` 接口（兼容格式）：`{ path: string; enabled: boolean }`（结构与内部相同，独立类型便于扩展）
  - `WorkspaceData` 加 `additionalPaths: AdditionalPath[]`
  - `Workspace` 兼容接口加 `additional_paths: AdditionalPathData[]`
  - `toWorkspace()` / `toWorkspaceData()` 双向转换时携带 additionalPaths，缺失时默认 `[]`
  - `add()` 创建新工作区时 `additionalPaths` 默认 `[]`
- [ ] `types/electron-api.ts` `Workspace` 接口加 `additional_paths: AdditionalPathData[]`
- [ ] `electron/main/types.ts` 如有 Workspace 镜像类型同步

### 1.2 边界函数改多根

- [ ] `electron/main/agents/pi-session/workspace-boundary.ts`
  - 保留 `assertSyntacticallyWithin` 和 `assertNoSymlinkEscape` 不变（内部函数复用）
  - 新增 `resolveWithinPaths(roots: string[], candidatePath: string): Promise<string>`
    - 遍历 roots，对每个 root 调 `path.resolve(root, candidatePath)` + 两层校验
    - 命中任一根路径即返回解析后的绝对路径
    - 全部不命中则抛 `路径越权` 错误（与现有错误信息格式一致，附带 candidatePath）
  - 保留原 `resolveWithinWorkspace(workspacePath, candidatePath)` 作为薄封装调 `resolveWithinPaths([workspacePath], candidatePath)`，避免现有调用点全部改动（search-tools 等在 Step 2 才切换）

### 1.3 WorkspaceExecutionEnv 改可变数组

- [ ] `electron/main/agents/pi-session/workspace-execution-env.ts`
  - 构造参数从 `workspacePath: string` 改为 `allowedPaths: string[]`
  - `this.cwd` 仍取 `allowedPaths[0]`（主路径，Bash 默认 cwd 和相对路径基准不变）
  - `this.allowedPaths` 存数组
  - `guard(candidate)` 改调 `resolveWithinPaths(this.allowedPaths, candidate)`
  - 新增 `updateAllowedPaths(paths: string[]): void`，直接赋值 `this.allowedPaths = paths`
  - `exec()` 的 `options.cwd` guard 不变（guard 内部已走多根）

## 实施回填（做完后填）

### 实际改动

- **`electron/main/agents/pi-session/workspace-boundary.ts`**
  - 新增 `resolveWithinPaths(roots: string[], candidatePath: string): Promise<string>`：遍历 roots 逐根尝试两层校验，命中即返回，全部不命中抛路径越权
  - `resolveWithinWorkspace` 改为薄封装调 `resolveWithinPaths([workspacePath], candidatePath)`
- **`electron/main/agents/pi-session/workspace-execution-env.ts`**
  - 构造参数从 `workspacePath: string` 改为 `allowedPaths: string[]`
  - `this.cwd` 取 `allowedPaths[0]`，`this.allowedPaths` 存数组（可变，非 readonly）
  - `guard()` 改调 `resolveWithinPaths(this.allowedPaths, candidate)`
  - 新增 `updateAllowedPaths(paths: string[]): void`，直接赋值 `this.allowedPaths`
- **`electron/main/services/workspace-json-service.ts`**
  - 新增 `AdditionalPath` 接口（内部格式）和 `AdditionalPathData` 接口（兼容格式），均为 `{ path: string; enabled: boolean }`
  - `WorkspaceData` 加 `additionalPaths: AdditionalPath[]`
  - `Workspace` 兼容接口加 `additional_paths: AdditionalPathData[]`
  - `toWorkspace()` / `toWorkspaceData()` 双向转换携带 additionalPaths，缺失时默认 `[]`
  - `add()` 创建新工作区时 `additionalPaths` 默认 `[]`（通过 `ws.additional_paths ?? []` 兼容旧格式入参）
- **`types/electron-api.ts`**
  - 新增 `AdditionalPathData` 接口导出
  - `Workspace` 接口加 `additional_paths: AdditionalPathData[]`
- **`electron/main/tipc/workspace.ts`**
  - 选择文件夹创建新工作区时补 `additional_paths: []`
- **`electron/main/agents/pi-session/pi-session.ts`**
  - `new WorkspaceExecutionEnv(this.config.workspacePath)` → `new WorkspaceExecutionEnv([this.config.workspacePath])`

### 给下一步的接力棒

- `WorkspaceExecutionEnv` 构造已接受 `string[]`，Step 2 需要从 workspace 数据中读取 `additionalPaths`，过滤 `enabled` 的，拼成 `[primary, ...enabled]` 传入构造或调 `updateAllowedPaths`
- `resolveWithinWorkspace` 仍保留（search-tools.ts 在用），Step 2 切换 search-tools 后可考虑删除
- `Workspace` 接口现在带 `additional_paths` 字段，前端消费时需处理（Step 3+ 的 UI 层）
- `electron/main/types.ts` 无 Workspace 镜像类型，无需改动
- `tipc/workspace.ts` 中已有工作区匹配（spread `existing`）会自动继承 `additional_paths`，新创建的工作区硬编码了 `additional_paths: []`
