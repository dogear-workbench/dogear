# Step 1 交付：工作区级配置服务

## 改动清单

### 新建文件（2 个）

1. **`electron/main/services/workspace-config-service.ts`**
   - `WorkspaceConfig` 接口：`{ enabledToolPacks: string[], enabledSkills: string[] }`
   - `getDefaultWorkspaceConfig()` → `{ enabledToolPacks: [], enabledSkills: [] }`
   - `getWorkspaceConfig(workspaceId)` → 读 `.dogear/workspaces/<id>/config.json`，不存在返回默认值
   - `updateWorkspaceConfig(workspaceId, partial)` → 合并写入，返回完整配置
   - 路径构建：`getConfigDir() + workspaces/<id>/config.json`，复用 safeJsonRead/safeJsonWrite

2. **`electron/main/tipc/workspace-config.ts`**
   - `getWorkspaceConfig` procedure（input: `{ workspaceId }`）
   - `updateWorkspaceConfig` procedure（input: `{ workspaceId, config: Partial<WorkspaceConfig> }`）
   - 错误处理与现有路由一致

### 修改文件（2 个）

3. **`electron/main/tipc/index.ts`**
   - 新增 `import { workspaceConfigRouter }`
   - 在 `router` 对象中展开 `...workspaceConfigRouter`

4. **`types/electron-api.ts`**
   - 新增 `WorkspaceConfig` 接口导出

## 验证

- `tsc --noEmit` 无新增编译错误（原有 pre-existing 错误与本次改动无关）
- 文件路径约定与 `workspace-json-service.ts` / `claude-config-service.ts` 一致

## 给下一步的接力棒

- 服务层 API：`getWorkspaceConfig(id)` / `updateWorkspaceConfig(id, partial)` / `getDefaultWorkspaceConfig()`
- tipc 已注册，前端可通过 `tipcClient.getWorkspaceConfig` / `tipcClient.updateWorkspaceConfig` 调用
- `WorkspaceConfig` 类型在 `types/electron-api.ts` 和 service 中均有导出
