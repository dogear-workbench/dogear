---
step: 5
title: 前端设置页改造
status: done
---

## 目标

AbilityTab 从"订阅复制 + 物理重命名"模型改为"配置读写"模型，工具包开关从全局 settings 改为工作区 config。

## 计划改动

### 5.1 数据模型改造

- [x] `app/settings/AbilityTab.tsx`
  - 新增 state：`workspaceConfig`（从 `client.getWorkspaceConfig({ workspaceId })` 加载）
  - `local.enabledToolPacks` → 改为从 `workspaceConfig.enabledToolPacks` 读取
  - 工具包开关：调用 `client.updateWorkspaceConfig({ workspaceId, config: { enabledToolPacks: [...] } })`
  - skill 开关：调用 `client.updateWorkspaceConfig({ workspaceId, config: { enabledSkills: [...] } })`
  - 删除所有 `client.subscribeSkillTemplate(...)` 调用
  - 删除所有 `client.setSkillEnabled(...)` 调用
  - `subscribedSkillNames` 概念不再存在——skill 是否挂载只看 `workspaceConfig.enabledSkills`

### 5.2 交互逻辑改造

- [x] skill 列表展示
  - 不再区分"已订阅/未订阅"
  - 改为"已挂载/未挂载"（在 enabledSkills 中 / 不在）
  - skill 的 source 显示：`builtin`（内置模板）/ `custom`（自定义）/ `user`（用户级）

- [x] 能力域开关（股票/文章/代码工作流）
  - `handleDomainToggle` 简化：一次性更新 `enabledSkills` + `enabledToolPacks`
  - 不再需要"先订阅再启用"两步操作

- [x] 删除"恢复"按钮（模板源只读，不存在"覆盖本地修改"的概念）
  - 内置模板始终从打包资源读取，用户不能编辑内置 skill 的内容
  - 自定义 skill 可以删除（文件操作，后续考虑）

### 5.3 其他前端文件

- [x] `app/settings/SubAgentTab.tsx`
  - SkillEntry.source 类型更新为 `'builtin' | 'custom' | 'user'`
  - `customSkillList` 过滤条件 `source === 'workspace'` → `source === 'custom'`
  - 子会话 Profile 的 skills/customSkills 勾选数据源不受影响（仍用 listSkillTemplates + listSkills）

- [x] `types/electron-api.ts`
  - `WorkspaceConfig` 接口已存在，无需修改
  - `subscribeSkillTemplate` / `setSkillEnabled` 无独立类型声明（tipc 自动推导），无需删除

## 实施回填

### 实际改动

#### `app/settings/AbilityTab.tsx`（~950行 → ~920行，全面重写）

**数据模型层：**
- 新增 `workspaceConfig` state（`WorkspaceConfig` 类型），从 `client.getWorkspaceConfig({ workspaceId })` 加载
- 新增 `enabledPackSet` / `enabledSkillSet`（从 workspaceConfig 派生的 Set）
- `listToolPacks` 调用改为传 `{ workspaceId }`（后端现在需要 workspaceId 来读取 config 中的 enabled 状态）
- `reload()` 函数新增 `getWorkspaceConfig` 调用
- SkillEntry.source 类型从 `'workspace' | 'user' | 'plugin' | 'marketplace'` 改为 `'builtin' | 'custom' | 'user'`
- 新增 `skillByName` memo（替代旧的 subscribedSkillNames + skills.find 混合查询）
- 删除 `subscribedSkillNames` / `allTemplateNames` 概念
- 删除 `busyTemplate` / `busyDir` state，新增 `busySkill` / `busyBulk` state
- `local` / `setLocal` props 前缀加 `_`（保留接口签名但不再使用）

**交互逻辑层：**
- 删除 `handleSubscribe`（订阅/恢复逻辑完全移除）
- 删除 `handleToggleSkillEnabled`（基于 dir 的 setSkillEnabled 调用移除）
- 新增 `handleToggleSkill(name, enable)`：直接 `updateWorkspaceConfig({ config: { enabledSkills: [...] } })`
- `handleDomainToggle` 简化：一次 `updateWorkspaceConfig` 调用同时更新 `enabledSkills` + `enabledToolPacks`
- 删除所有 `client.subscribeSkillTemplate` 调用（4处）
- 删除所有 `client.setSkillEnabled` 调用（3处）
- 删除 `workspacePath` 依赖（不再需要文件路径操作）
- 删除 `showConfirm` 导入（不再需要确认对话框）

**子组件层：**
- `SkillRow` 重构：
  - 删除 `subscribed` / `showSubscribe` / `onSubscribe` / `dir` / `onToggleEnabled` props
  - 新增 `source` / `showToggle` / `onToggle(name, enabled)` props
  - 新增 source 标签显示（内置/自定义/用户级）
  - 状态标签从"已订阅/已禁用"改为"已挂载/未挂载"
  - 删除"恢复/订阅"按钮，保留开关 + 详情按钮
- `SkillRowCompact` 删除（被 SkillRow 统一替代，通过 showToggle 参数控制）
- `PackGroupList` 删除不再使用的 `packByNameMap` prop

**能力域展示层：**
- 记忆系统 Skill：用统一 SkillRow，source + toggle
- 股票分析：DomainToggle 一次性切换 skill+pack，SkillRow 显示单个 skill 状态
- 代码工作流：DomainToggle 切换 skill，SkillRow 显示单个 skill 状态
- 文章：新增 DomainToggle（之前没有），一次性切换 article-parser skill + article pack
- 自定义 Skill：SkillRow 显示 source + toggle

#### `app/settings/SubAgentTab.tsx`（2处小改）

- `SkillEntry.source` 类型：`string` → `'builtin' | 'custom' | 'user'`
- `customSkillList` 过滤：`source === 'workspace'` → `source === 'custom'`

#### `types/electron-api.ts`（无需修改）

- `WorkspaceConfig` 接口已存在
- 无 `subscribeSkillTemplate` / `setSkillEnabled` 独立类型声明（tipc 自动推导类型）

### 给下一步的接力棒

- 前端不再调用 `subscribeSkillTemplate`（后端已删除该路由），不再调用 `setSkillEnabled`（仍存在但应不再被前端使用）
- 所有 skill/pack 开关状态统一通过 `getWorkspaceConfig` / `updateWorkspaceConfig` 读写
- `listSkillTemplates` 仍用于获取内置模板名称+描述（展示用），`listSkills` 返回完整 skill 列表含 source 和 enabled
- `listToolPacks` 现在需要 `{ workspaceId }` 参数
- 文章域新增了 DomainToggle（之前没有），用户可一键切换文章 skill + 工具包
- `SkillDetailDialog` 的 `getSkillContent({ name })` 仍正常工作（从模板源读取，只读展示）
