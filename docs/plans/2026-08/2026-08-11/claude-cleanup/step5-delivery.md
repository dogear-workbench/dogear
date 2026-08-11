# Step 5 交付：前端设置页改造

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `app/settings/AbilityTab.tsx` | 全面重写 | 从订阅模型改为配置读写模型 |
| `app/settings/SubAgentTab.tsx` | 小改 | SkillEntry.source 类型更新 + 过滤条件更新 |
| `types/electron-api.ts` | 无修改 | WorkspaceConfig 已存在，无类型声明需删除 |
| `docs/plans/.../step5-frontend.md` | 更新 | 回填实施记录 |

## 核心变更

### AbilityTab.tsx

**数据模型：**
- 新增 `workspaceConfig` state（`{ enabledToolPacks: string[], enabledSkills: string[] }`）
- 从 `client.getWorkspaceConfig({ workspaceId })` 加载
- 工具包/skill 开关状态全部从 `workspaceConfig` 派生
- `local.enabledToolPacks` 不再使用（props 保留签名但加 `_` 前缀）

**交互逻辑：**
- 删除 `handleSubscribe`（订阅/恢复逻辑完全移除）
- 删除 `handleToggleSkillEnabled`（基于 dir 的 setSkillEnabled 移除）
- 新增 `handleToggleSkill(name, enable)`：直接 `updateWorkspaceConfig({ config: { enabledSkills } })`
- `handleDomainToggle` 简化：一次 `updateWorkspaceConfig` 同时更新 enabledSkills + enabledToolPacks
- 删除所有 `client.subscribeSkillTemplate` 调用（4处）
- 删除所有 `client.setSkillEnabled` 调用（3处）

**子组件：**
- `SkillRow` 重构：删除 subscribed/subscribe/dir 概念，新增 source 标签 + toggle
- `SkillRowCompact` 删除（被 SkillRow 统一替代）
- `PackGroupList` 删除 `packByNameMap` prop

**能力域：**
- 文章域新增 DomainToggle（之前没有总开关）
- 所有 skill 展示从"已订阅/已禁用"改为"已挂载/未挂载"

### SubAgentTab.tsx
- `SkillEntry.source` 类型：`string` → `'builtin' | 'custom' | 'user'`
- `customSkillList` 过滤：`source === 'workspace'` → `source === 'custom'`

## 验证
- `tsc --noEmit`：0 个新错误（原有错误均为预先存在）
- `eslint`：0 个 error，9 个 any warning（与原代码风格一致）
- `vite build`：构建成功
