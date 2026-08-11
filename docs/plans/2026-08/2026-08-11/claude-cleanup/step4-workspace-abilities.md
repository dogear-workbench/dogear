---
step: 4
title: 能力配置拆到工作区级
status: done
---

## 目标

`enabledToolPacks` 从全局 `settings.json` 移到工作区 `config.json`，conversation-runtime-service 和 pi-session 的读取链路全部改到工作区级。

## 依赖上下文（接力棒输入）

- Step 1 产出：`workspace-config-service.ts` 已就绪
- Step 3 产出：`enabledSkills` 的读取链路已迁移完毕（skill 过滤已用工作区 config）
- 当前 `enabledToolPacks` 在全局 settings：`settings-types.ts:107` 定义，`conversation-runtime-service.ts:93` 读取
- pi-session 接收 `enabledToolPacks`：`pi-session.ts:68` 的 `PiSessionConfig`，由 `conversation-runtime-service.ts:91` 传入

## 计划改动

### 4.1 数据读取链路改造

- [ ] `electron/main/services/conversation-runtime-service.ts:88-93`
  - 当前：`const appSettings = await loadSettings(); ... enabledToolPacks: appSettings.enabledToolPacks ?? []`
  - 改为：`const wsConfig = await getWorkspaceConfig(workspaceId); ... enabledToolPacks: wsConfig.enabledToolPacks`
  - 注意：`workspaceId` 在此函数作用域内已可用（`conversation.workspaceId` 或参数传入）

- [ ] `electron/main/agents/pi-session/pi-session.ts`
  - `PiSessionConfig.enabledToolPacks`（`:68`）来源已变，接口签名不变，只是上游传值变了
  - 无需改动 pi-session 内部

### 4.2 全局 settings 清理

- [ ] `electron/main/services/settings-types.ts`
  - 删除 `AppSettings.enabledToolPacks` 字段（`:107`）
  - 删除 `DEFAULT_SETTINGS.enabledToolPacks`（`:133`）

- [ ] `electron/main/services/settings-service.ts`
  - `normalizeSettings` 中如果有 `enabledToolPacks` 相关的 normalize 逻辑，清理掉

- [ ] `electron/main/services/settings-normalize.test.ts`
  - 删除 `enabledToolPacks` 相关的测试用例

### 4.3 tipc 路由

- [ ] 检查所有通过 tipc 读写 `enabledToolPacks` 的路由，改为走 `workspace-config-service`
  - 当前前端通过 `local.enabledToolPacks` + `setLocal` 读写全局 settings，Step 5 会改前端
  - 此 step 只需确保 tipc 层有 `getWorkspaceConfig` / `updateWorkspaceConfig`（Step 1 已建）

## 实施回填（做完后填）

### 实际改动

**4.1 数据读取链路改造**
- `electron/main/services/conversation-runtime-service.ts`
  - 新增 import `getWorkspaceConfig` from `workspace-config-service.js`
  - 新增 `const wsConfig = await getWorkspaceConfig(workspaceId);`
  - `enabledToolPacks: appSettings.enabledToolPacks ?? []` → `enabledToolPacks: wsConfig.enabledToolPacks`
- `electron/main/agents/pi-session/pi-session.ts`：无需改动（接口签名不变）

**4.2 全局 settings 清理**
- `electron/main/services/settings-types.ts`
  - 删除 `AppSettings.enabledToolPacks?: string[]` 字段
  - 删除 `DEFAULT_SETTINGS.enabledToolPacks: []`
- `types/settings.ts`（渲染层镜像，保持同步）
  - 删除 `AppSettings.enabledToolPacks?: string[]` 字段
  - 删除 `DEFAULT_SETTINGS.enabledToolPacks: []`
- `electron/main/services/settings-service.ts`：`normalizeSettings` 中无 `enabledToolPacks` 相关逻辑，无需改动
- `electron/main/services/settings-normalize.test.ts`：从「规范化不丢失无关的有效设置」测试中移除 `enabledToolPacks` 相关断言

**4.3 tipc 路由**
- `electron/main/tipc/agent.ts`：`listToolPacks` 路由改为接受 `{ workspaceId: string }` 输入，从 `getWorkspaceConfig` 读取启用状态（原来读 `loadSettings().enabledToolPacks`）
- `electron/main/services/workspace-config.ts`：Step 1 已建 `getWorkspaceConfig` / `updateWorkspaceConfig`，无需改动
- `electron/main/services/tool-packs.ts`：更新注释引用

### 给下一步的接力棒

- `listToolPacks` 路由签名已改（需 `{ workspaceId }` 入参），前端 `AbilityTab.tsx:489` 的 `client.listToolPacks()` 调用需在 Step 5 更新为 `client.listToolPacks({ workspaceId })`
- `AbilityTab.tsx` 中 `enabledPackSet` 来源于 `local.enabledToolPacks`（全局 settings），需改为从 `workspaceConfig.enabledToolPacks` 读取
- `AbilityTab.tsx` 中 `handleDomainToggle` 写入 `local.enabledToolPacks`（全局 settings），需改为 `client.updateWorkspaceConfig({ workspaceId, config: { enabledToolPacks: [...] } })`
- 全局 `settings.json` 中可能残留旧的 `enabledToolPacks` 字段，Step 6 迁移脚本需处理
- `types/settings.ts` 已同步删除字段，Step 5 不用再动这个文件
