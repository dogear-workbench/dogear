---
step: 5
title: 前端设置页改造
status: pending
---

## 目标

AbilityTab 从"订阅复制 + 物理重命名"模型改为"配置读写"模型，工具包开关从全局 settings 改为工作区 config。

## 依赖上下文（接力棒输入）

- Step 1 产出：tipc 有 `getWorkspaceConfig` / `updateWorkspaceConfig`
- Step 3 产出：skill 的 source 变为 `builtin` / `custom` / `user`，enabled 状态由工作区 config 决定
- Step 4 产出：`enabledToolPacks` 不再在全局 settings 中
- 当前前端代码：`app/settings/AbilityTab.tsx`（~950 行）

## 计划改动

### 5.1 数据模型改造

- [ ] `app/settings/AbilityTab.tsx`
  - 新增 state：`workspaceConfig`（从 `client.getWorkspaceConfig({ workspaceId })` 加载）
  - `local.enabledToolPacks` → 改为从 `workspaceConfig.enabledToolPacks` 读取
  - 工具包开关：调用 `client.updateWorkspaceConfig({ workspaceId, config: { enabledToolPacks: [...] } })`
  - skill 开关：调用 `client.updateWorkspaceConfig({ workspaceId, config: { enabledSkills: [...] } })`
  - 删除所有 `client.subscribeSkillTemplate(...)` 调用
  - 删除所有 `client.setSkillEnabled(...)` 调用
  - `subscribedSkillNames` 概念不再存在——skill 是否挂载只看 `workspaceConfig.enabledSkills`

### 5.2 交互逻辑改造

- [ ] skill 列表展示
  - 不再区分"已订阅/未订阅"
  - 改为"已挂载/未挂载"（在 enabledSkills 中 / 不在）
  - skill 的 source 显示：`builtin`（内置模板）/ `custom`（自定义）/ `user`（用户级）

- [ ] 能力域开关（股票/文章/代码工作流）
  - `handleDomainToggle` 简化：一次性更新 `enabledSkills` + `enabledToolPacks`
  - 不再需要"先订阅再启用"两步操作

- [ ] 删除"恢复"按钮（模板源只读，不存在"覆盖本地修改"的概念）
  - 内置模板始终从打包资源读取，用户不能编辑内置 skill 的内容
  - 自定义 skill 可以删除（文件操作，后续考虑）

### 5.3 其他前端文件

- [ ] `app/settings/SubAgentTab.tsx`
  - 子会话 Profile 里如果有 `skills` / `customSkills` 的勾选列表，确认数据源是否受影响
  - 子会话 skill 过滤逻辑在 pi-session 的 `filterSkillsForSubAgent` 中，前端只需传 skill name 列表

- [ ] `types/electron-api.ts`
  - 删除 `subscribeSkillTemplate` 类型声明
  - 删除 `setSkillEnabled` 旧的类型声明（或改为新签名）
  - 新增 `getWorkspaceConfig` / `updateWorkspaceConfig` 类型声明

## 实施回填（做完后填）

### 实际改动

（待填）

### 给下一步的接力棒

（待填）
