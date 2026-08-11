---
step: 1
title: 工作区级配置服务
status: pending
---

## 目标

新建 `workspace-config-service.ts`，提供读写 `.dogear/workspaces/<id>/config.json` 的能力，为后续步骤提供基础。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-08/2026-08-11/claude-cleanup-design.md`
- 配置目录结构：`.dogear/workspaces/<id>/` 下已有 `conversations.json` / `agent.md` / `groups.json` 等
- 参考 `workspace-json-service.ts` 的 `getConfigDir()` 和路径约定
- 参考 `safe-json.ts` 的 `safeJsonRead` / `safeJsonWrite`

## 计划改动

- [ ] `electron/main/services/workspace-config-service.ts`（新建）
  - 定义 `WorkspaceConfig` 接口：`{ enabledToolPacks: string[], enabledSkills: string[] }`
  - `getWorkspaceConfig(workspaceId): Promise<WorkspaceConfig>` — 读 `.dogear/workspaces/<id>/config.json`，不存在返回默认值
  - `updateWorkspaceConfig(workspaceId, partial: Partial<WorkspaceConfig>): Promise<WorkspaceConfig>` — 合并写入，返回完整配置
  - `getDefaultWorkspaceConfig(): WorkspaceConfig` — 返回 `{ enabledToolPacks: [], enabledSkills: [] }`
  - 路径：`path.join(getConfigDir(), 'workspaces', workspaceId, 'config.json')`
- [ ] `electron/main/tipc/workspace-config.ts`（新建 tipc 路由）
  - `getWorkspaceConfig: t.procedure.input<{ workspaceId: string }>()`
  - `updateWorkspaceConfig: t.procedure.input<{ workspaceId: string; config: Partial<WorkspaceConfig> }>()`
- [ ] 在 `electron/main/tipc/index.ts`（或聚合处）注册路由
- [ ] `types/electron-api.ts` 补充对应类型声明

## 实施回填（做完后填）

### 实际改动

（待填）

### 给下一步的接力棒

（待填）
