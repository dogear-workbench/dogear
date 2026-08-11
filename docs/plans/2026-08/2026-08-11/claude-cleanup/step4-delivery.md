# Step 4 交付：能力配置拆到工作区级

## 改动清单

### 4.1 数据读取链路改造

| 文件 | 改动 |
|------|------|
| `electron/main/services/conversation-runtime-service.ts:8` | 新增 `import { getWorkspaceConfig } from './workspace-config-service.js'` |
| `electron/main/services/conversation-runtime-service.ts:88` | 新增 `const wsConfig = await getWorkspaceConfig(workspaceId);` |
| `electron/main/services/conversation-runtime-service.ts:93` | `enabledToolPacks: appSettings.enabledToolPacks ?? []` → `enabledToolPacks: wsConfig.enabledToolPacks` |

pi-session (`electron/main/agents/pi-session/pi-session.ts`) 接口签名不变，无需改动。

### 4.2 全局 settings 清理

| 文件 | 改动 |
|------|------|
| `electron/main/services/settings-types.ts:107` | 删除 `AppSettings.enabledToolPacks?: string[]` |
| `electron/main/services/settings-types.ts:133` | 删除 `DEFAULT_SETTINGS.enabledToolPacks: []` |
| `types/settings.ts:126` | 删除渲染层镜像 `AppSettings.enabledToolPacks?: string[]`（保持同步） |
| `types/settings.ts:152` | 删除 `DEFAULT_SETTINGS.enabledToolPacks: []` |
| `electron/main/services/settings-normalize.test.ts:141-146` | 从「规范化不丢失无关的有效设置」测试中移除 `enabledToolPacks` 相关断言 |
| `electron/main/services/tool-packs.ts:20` | 更新注释（`settings.enabledToolPacks` → `workspace config 的 enabledToolPacks`） |

`settings-service.ts` 的 `normalizeSettings` 中无 `enabledToolPacks` 相关逻辑，无需改动。

### 4.3 tipc 路由

| 文件 | 改动 |
|------|------|
| `electron/main/tipc/agent.ts:475` | `listToolPacks` 路由：新增 `.input<{ workspaceId: string }>()`，改读 `getWorkspaceConfig(input.workspaceId).enabledToolPacks`（原来是 `loadSettings().enabledToolPacks`） |

`workspace-config.ts` tipc 路由（`getWorkspaceConfig` / `updateWorkspaceConfig`）Step 1 已建，无需改动。

## 验证

- `bun run build:electron`（tsc -p tsconfig.electron.json）：**通过，无错误**
- `bun test electron/main/services/settings-normalize.test.ts`：**18 pass / 0 fail**
- 前端 tsc 预存错误（EffortLevel 不匹配等）非本次引入

## 给 Step 5 的接力棒

1. **`listToolPacks` 调用签名变更**：`AbilityTab.tsx:489` 的 `client.listToolPacks()` 需改为 `client.listToolPacks({ workspaceId })`
2. **`enabledPackSet` 数据源变更**：`AbilityTab.tsx:474` 的 `local.enabledToolPacks` 需改为从 `workspaceConfig.enabledToolPacks` 读取（通过 `client.getWorkspaceConfig({ workspaceId })`）
3. **`handleDomainToggle` 写入路径变更**：`AbilityTab.tsx:617/653` 的 `setLocal((prev) => ({ ...prev, enabledToolPacks: ... }))` 需改为 `client.updateWorkspaceConfig({ workspaceId, config: { enabledToolPacks: [...] } })`
4. **`types/settings.ts` 已同步**：已删除 `enabledToolPacks` 字段，Step 5 不用再动
5. **全局 `settings.json` 残留**：旧 `enabledToolPacks` 可能仍存在于用户磁盘，Step 6 迁移脚本需处理
