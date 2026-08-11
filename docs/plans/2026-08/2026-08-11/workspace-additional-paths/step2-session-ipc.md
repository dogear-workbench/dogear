---
step: 2
title: Session 层 + IPC 热更新
status: done
---

## 目标

PiSession 接收附加路径并传给 WorkspaceExecutionEnv；新增 IPC 路由管理附加路径 CRUD；写盘后热更新到活跃会话。

## 依赖上下文（接力棒输入）

- 前置 step：[step1-data-boundary.md] 改了 `resolveWithinPaths(roots[], candidate)` 和 `WorkspaceExecutionEnv` 构造参数为 `allowedPaths: string[]`，新增 `updateAllowedPaths(paths[])` 方法
- `PiSessionConfig` 在 `electron/main/agents/pi-session/pi-session.ts`，`start()` 在 `:178` 创建 `WorkspaceExecutionEnv`
- `PiSessionManager` 在 `electron/main/agents/pi-session/pi-session-manager.ts`，创建 PiSession 时传 config
- IPC 路由在 `electron/main/tipc/workspace.ts`

## 计划改动

### 2.1 PiSession 传附加路径

- [ ] `electron/main/agents/pi-session/pi-session.ts`
  - `PiSessionConfig` 加 `additionalPaths: string[]`（已过滤 enabled 的绝对路径数组）
  - `start()` 里创建 env 改为：`new WorkspaceExecutionEnv([this.config.workspacePath, ...this.config.additionalPaths])`
  - 暴露 `getEnv()` 或 `updateAllowedPaths` 的代理方法，供 IPC 热更新调用（方案：PiSession 持有 env 引用，暴露 `updateWorkspacePaths(additionalPaths: string[])` 方法内部调 `this.env?.updateAllowedPaths([this.config.workspacePath, ...additionalPaths])`）

### 2.2 PiSessionManager 热更新入口

- [ ] `electron/main/agents/pi-session/pi-session-manager.ts`
  - 新增方法：按 workspaceId 找到活跃 PiSession，调 `piSession.updateWorkspacePaths(enabledPaths)`
  - 可能需要遍历当前持有的 session 实例（一个 workspace 可能有多个活跃会话，全部更新）

### 2.3 IPC 路由

- [ ] `electron/main/tipc/workspace.ts`
  - `addAdditionalPath({ workspaceId, path })`：读 workspace → push 到 additionalPaths（默认 enabled=true）→ 写盘 → 热更新
  - `removeAdditionalPath({ workspaceId, path })`：过滤移除 → 写盘 → 热更新
  - `toggleAdditionalPath({ workspaceId, path, enabled })`：修改对应条目 enabled → 写盘 → 热更新
  - 热更新辅助函数：读 workspace 拿 `additionalPaths.filter(p => p.enabled).map(p => p.path)` → 调 PiSessionManager 更新该 workspaceId 下所有活跃 session

### 2.4 搜索工具适配

- [ ] `electron/main/agents/pi-session/search-tools.ts`
  - `createSearchToolDefs(workspacePath)` → `createSearchToolDefs(allowedPaths: string[])`（或 `workspacePath` + `additionalPaths` 两个参数）
  - `resolveWithinWorkspace(workspacePath, subPath)` 换成 `resolveWithinPaths(allowedPaths, subPath)`
  - `walkFiles` 的相对路径基准：主工作区搜索结果仍相对主路径；附加路径搜索结果用绝对路径（agent 用绝对路径发起的搜索，返回绝对路径一致）

### 2.5 client.ts 前端 IPC 客户端

- [ ] `src/lib/client.ts`（或 tipc 客户端所在文件）
  - 新增 `addAdditionalPath` / `removeAdditionalPath` / `toggleAdditionalPath` 方法映射

## 实施回填（做完后填）

### 实际改动
- `pi-session.ts`：PiSessionConfig 加 additionalPaths；start() 用 [primary, ...additional] 构造 env；新增 getWorkspaceId()/updateWorkspacePaths() 方法；createSearchToolDefs 调用改为传数组
- `pi-session-manager.ts`：新增 updateWorkspacePaths(workspaceId, enabledPaths) 遍历所有活跃 session 热更新
- `search-tools.ts`：签名改为 allowedPaths: string[]；import 换 resolveWithinPaths；新增 FileEntry/collectFiles 辅助；Glob/Grep 适配多路径（primary 相对路径、extras 绝对路径）
- `conversation-runtime-service.ts`：createSession config 加 additionalPaths（从 workspace.additional_paths 过滤 enabled）
- `tipc/workspace.ts`：新增 addAdditionalPath/removeAdditionalPath/toggleAdditionalPath IPC + hotUpdateAdditionalPaths 辅助函数
- `workspace-json-service.ts`：新增 update(id, ws) 全量覆写方法

### 给下一步的接力棒
- 前端可直接用 client.addAdditionalPath / removeAdditionalPath / toggleAdditionalPath，返回 { success, workspace?, error? }
- workspace 返回值已含更新后的 additional_paths，前端可直接刷新状态
- 搜索工具对附加路径返回绝对路径，主路径返回相对路径
- lib/client.ts 无需改动（Router 类型自动推导）
