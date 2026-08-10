---
step: 2
title: 设置类型 + 归一化
status: done
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
- `settings-types.ts` — 新增 SubAgentEnabledAbilities + SubAgentProfile 接口、createDefaultSubAgentProfile() 工厂函数，subAgent 改为 `{ profiles: SubAgentProfile[] }`
- `types/settings.ts` — 渲染进程同步新增类型和工厂函数
- `settings-service.ts` — normalizeSettings 重构：旧字段清理(cachePolicy/loadCoreProfile/loadSkills/loadArticleParse) + profiles 补全/迁移
- `settings-normalize.test.ts` — 3 个现有测试适配 + 3 个新增测试，17 pass

### 给下一步的接力棒
- `SubAgentProfile` 在 `settings-types.ts:71` 和 `types/settings.ts:90` 定义
- `createDefaultSubAgentProfile()` 在 `settings-types.ts:171` 和 `types/settings.ts:68` 导出
- 归一化后 `AppSettings.subAgent = { profiles: SubAgentProfile[] }`
- **已知编译错误（预期，需 step3-4 修复）**：
  1. `delegation-bridge.ts:191` — 读 `subAgent.modelSelection` → 改为从选中 profile 读
  2. `delegation-bridge.ts:214` — 读 `subAgent.cachePolicy` → 固定 '5m'
  3. `delegation-bridge.ts:267` — 读 `subAgent.timeoutMinutes` → 从选中 profile 读
  4. `pi-session.ts:237` — 读 `subAgent.loadCoreProfile` → 改为读 profile.enabledAbilities
  5. `delegation-tools.ts:127` — 读 `subAgent.timeoutMinutes` → 从选中 profile 读
