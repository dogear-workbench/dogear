---
step: 1
title: 工作区级配置服务
status: done
---

## 目标

新建 `workspace-config-service.ts`，提供读写 `.dogear/workspaces/<id>/config.json` 的能力，为后续步骤提供基础。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-11/claude-cleanup-design.md`
- 配置目录结构：`.dogear/workspaces/<id>/` 下已有 `conversations.json` / `agent.md` / `groups.json` 等
- 参考 `workspace-json-service.ts` 的 `getConfigDir()` 和路径约定
- 参考 `safe-json.ts` 的 `safeJsonRead` / `safeJsonWrite`

## 计划改动

- [x] `electron/main/services/workspace-config-service.ts`（新建）
  - 定义 `WorkspaceConfig` 接口：`{ enabledToolPacks: string[], enabledSkills: string[] }`
  - `getWorkspaceConfig(workspaceId): Promise<WorkspaceConfig>` — 读 `.dogear/workspaces/<id>/config.json`，不存在返回默认值
  - `updateWorkspaceConfig(workspaceId, partial: Partial<WorkspaceConfig>): Promise<WorkspaceConfig>` — 合并写入，返回完整配置
  - `getDefaultWorkspaceConfig(): WorkspaceConfig` — 返回 `{ enabledToolPacks: [], enabledSkills: [] }`
  - 路径：`path.join(getConfigDir(), 'workspaces', workspaceId, 'config.json')`
- [x] `electron/main/tipc/workspace-config.ts`（新建 tipc 路由）
  - `getWorkspaceConfig: t.procedure.input<{ workspaceId: string }>()`
  - `updateWorkspaceConfig: t.procedure.input<{ workspaceId: string; config: Partial<WorkspaceConfig> }>()`
- [x] 在 `electron/main/tipc/index.ts`（或聚合处）注册路由
- [x] `types/electron-api.ts` 补充对应类型声明

## 实施回填（做完后填）

### 实际改动

1. **新建** `electron/main/services/workspace-config-service.ts`
   - 定义 `WorkspaceConfig` 接口：`{ enabledToolPacks: string[], enabledSkills: string[] }`
   - `getDefaultWorkspaceConfig()` → `{ enabledToolPacks: [], enabledSkills: [] }`
   - `getWorkspaceConfig(workspaceId)` → 读 `.dogear/workspaces/<id>/config.json`，不存在返回默认值（走 `safeJsonRead`）
   - `updateWorkspaceConfig(workspaceId, partial)` → 合并写入（走 `safeJsonWrite`），返回完整配置
   - `getConfigDir()` 复用 claude-config-service 的三段式逻辑（env / packaged / cwd）

2. **新建** `electron/main/tipc/workspace-config.ts`
   - `getWorkspaceConfig: t.procedure.input<{ workspaceId: string }>()`
   - `updateWorkspaceConfig: t.procedure.input<{ workspaceId: string; config: Partial<WorkspaceConfig> }>()`
   - 错误处理与 claude-config.ts 一致（catch → `{ error: String(error) }`）

3. **修改** `electron/main/tipc/index.ts`
   - import `workspaceConfigRouter`，展开注册到 `router`

4. **修改** `types/electron-api.ts`
   - 新增 `WorkspaceConfig` 接口（`enabledToolPacks` / `enabledSkills`）

### 给下一步的接力棒

- 服务层已就绪：`getWorkspaceConfig(workspaceId)` / `updateWorkspaceConfig(workspaceId, partial)` / `getDefaultWorkspaceConfig()`
- tipc 路由已注册：前端可通过 `tipcClient.getWorkspaceConfig({ workspaceId })` / `tipcClient.updateWorkspaceConfig({ workspaceId, config })` 调用
- `WorkspaceConfig` 类型在 `types/electron-api.ts` 和 service 文件中均有导出
- Step 2+ 可直接消费此服务来读写工具包和 skill 的启用状态
