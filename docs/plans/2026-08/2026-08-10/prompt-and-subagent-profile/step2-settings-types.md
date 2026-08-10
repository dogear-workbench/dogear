---
step: 2
title: 设置类型 + 归一化
status: pending
---

## 目标

定义 `SubAgentProfile` 类型，重构 `AppSettings.subAgent` 为 `{ profiles: SubAgentProfile[] }`，编写旧字段归一化逻辑。

## 依赖上下文（接力棒输入）

- 类型定义位置：`electron/main/services/settings-types.ts`（主进程）+ `app/types/settings.ts`（渲染进程），两处需同步
- 归一化逻辑位置：`electron/main/services/settings-normalize.ts`
- `DEFAULT_SETTINGS` 位置：`settings-types.ts:103`
- 当前 `subAgent` 结构和默认值见 `settings-types.ts:82-93` 和 `settings-types.ts:119-125`
- 主进程归一化调用点：`settings-service.ts:154`（normalizeSettings 函数）

## 计划改动

### 2.1 类型定义

- [ ] `electron/main/services/settings-types.ts`：
  - 新增 `SubAgentProfile` 接口（含 id/name/description/modelSelection/timeoutMinutes/enabledBasicTools/enabledAbilities）
  - 新增 `SubAgentEnabledAbilities` 接口
  - 改 `AppSettings.subAgent` 类型为 `{ profiles: SubAgentProfile[] }`
  - 更新 `DEFAULT_SETTINGS.subAgent` 为 `{ profiles: [DEFAULT_PROFILE] }`
  - 导出 `createDefaultSubAgentProfile()` 工厂函数（返回默认 Profile 副本）
- [ ] `app/types/settings.ts`：同步新增 `SubAgentProfile` 类型，更新 `AppSettings.subAgent`

### 2.2 归一化

- [ ] `electron/main/services/settings-normalize.ts`：
  - 处理 `subAgent` 字段迁移：
    - 如果有 `subAgent.profiles`（新结构）→ 验证并补全每个 profile 的字段（enabledBasicTools 默认全开、enabledAbilities 默认空对象）
    - 如果没有 `subAgent.profiles`（旧结构或全新安装）→ 从旧字段构建默认 Profile
  - 旧字段映射规则（见 plan.md 全局决策）
  - 删除旧的 `cachePolicy`、`loadCoreProfile`、`loadSkills`、`loadArticleParse` 字段
- [ ] `electron/main/services/settings-normalize.test.ts`：更新测试用例（旧 subAgent.permissionMode 测试改为新结构测试）

### 2.3 设置服务

- [ ] `electron/main/services/settings-service.ts`：检查 `normalizeSettings` 中 `subAgent` 的处理逻辑（`settings-service.ts:154`），确保新结构正确 deepMerge

## 验证

- `bun run build:electron` 编译通过
- 现有 settings-normalize.test.ts 测试通过（更新后）
- 手动检查：旧 settings.json（含 `subAgent.loadSkills` 等）归一化后变成 `subAgent.profiles: [defaultProfile]`

## 实施回填（做完后填）

### 实际改动
- （待填）

### 给下一步的接力棒
- `SubAgentProfile` 类型的完整签名（供后续 step 引用）
- `createDefaultSubAgentProfile()` 的导出路径
- 归一化后的 `AppSettings.subAgent` 结构（供 pi-session.ts 和 delegation-bridge.ts 读取）
