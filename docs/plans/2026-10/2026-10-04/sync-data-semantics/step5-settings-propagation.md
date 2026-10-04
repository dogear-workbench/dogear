---
step: 5
title: settings 白名单传播制
status: done
---

## 目标
settings.json 三方合并从「全字段」改为「白名单字段传播、其余保本端」，根治 snapshot 类机器亲和字段的跨端污染。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.2（A 模型、分类草案、选 A 弃 B 理由）
- 前置 step 产出：[step1-registry-settings-model.md] `SETTINGS_SYNC_FIELDS` 白名单常量草案已立
- 现状：`apply.ts` `mergeFieldsThreeWay` 全字段三方合并；`computeMergedSettings` 内 syncOptions 走 rev-LWW 特判（保持不动）；双改警告 `onWarning` 机制已有
- 注意：settings.json 的 persist 走 saveSettings（默认值合并 + 副作用），改造不触碰该路径

## 计划改动
- [x] 逐字段核对 AppSettings 真实结构（`settings-types.ts` / settings-service 各 normalize 函数），定稿 `SETTINGS_SYNC_FIELDS`；特别注意 `ai` 内是否混有 API key 类敏感值（有则降级为保本端或拆字段，回填记录结论）
- [x] `apply.ts` `mergeFieldsThreeWay` 改造：仅白名单字段进三方合并；非白名单字段一律取本端（含未知新字段）；双改警告只对白名单字段冲突报告；syncOptions 特判逻辑原样保留（在白名单之外自成体系）
- [x] 基线语义核对：settingsBaseline 记录合并落盘全量结果，非白名单字段保本端后基线自然收敛，确认无振荡（下轮 diff 不误判）
- [x] 测试：白名单字段单侧变传播 / 双改保本端+警告；非白名单（snapshot/backup/ui）单侧变**不**传播；未知新字段保守保本端；syncOptions rev-LWW 不回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 白名单定稿 = 草案 9 项不变（逐字段核对后无增删）；`ai` 核对无 API key（key 在 `profiles.apiKey` 与 `webMcpApiKey`，均已保本端），模型选择字段仅为 `ModelSelection {profileId, tier}` 引用，保留白名单
  - 计划未明说的补充决策：**无基线（首次同步）退化路径同样白名单制**——原实现 `{...incoming}` 整份以对端为底，会把对端 snapshot/webMcpApiKey 污染到本端，与白名单制目标矛盾；改为白名单字段以对端为底初始化、白名单外仍保本端
  - 白名单外字段双改不警告（机器亲和字段本端态不算冲突，警告只报白名单双改）
- 改动文件清单：
  - `electron/main/services/sync/apply.ts`：`mergeFieldsThreeWay` 改白名单制（仅 `SETTINGS_SYNC_FIELDS` 进三方合并循环，白名单外经 `takeLocalExceptSyncFields` 保本端）；`computeMergedSettings` 无基线退化分支同步改造；`SETTINGS_SYNC_FIELD_SET` 私有常量；syncOptions rev-LWW 特判未动
  - `electron/main/services/settings-types.ts`：`SETTINGS_SYNC_FIELDS` 注释草案→定稿（含 ai 核对结论）
  - `electron/main/services/sync/settings-merge.test.ts`：原全字段合并用例改用白名单字段（a/b/c、cfg、legacy 等占位字段已非白名单）；新增白名单外不传播/双改不警告/未知字段保本端/两轮基线收敛无振荡/无基线首次同步不被污染 5 个用例
  - `electron/main/services/sync/sync-options-merge.test.ts`：`SETTINGS_SYNC_FIELDS` 锁定测试草案→定稿（断言不变，9 项一致）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `mergeFieldsThreeWay(local, incoming, baseline, onWarning?)`：白名单字段三方合并 + 白名单外保本端；返回 merged（键序 = 白名单序 + 本端非白名单键序，deepEqual 键序无关故基线比对不受影响）
  - `takeLocalExceptSyncFields(merged, local)`：白名单外字段（含未知新字段）从 local 拷入；本端无该键则结果无该键，默认值由 saveSettings/loadSettings 兜底
  - `SETTINGS_SYNC_FIELDS`（settings-types.ts:558）：9 项白名单，`as const satisfies readonly (keyof AppSettings)[]` 防 typo；17 顶层字段 = 9 白名单 + 8 保本端全覆盖
- 下个 step 该从哪里继续：Step 6（UI 分组勾选）；settings.json 条目级合并链路（MERGE_PATTERNS settings.json → computeMergedSettings）本步后无需再动
- 待办或已知限制：
  - 行为变化：`profiles`（含 AI 供应商 apiKey/baseUrl）不再跨设备——新设备需各配一次 AI 供应商，属设计拍板预期
  - `failover` 在白名单内但依赖本端 profiles 校正（normalizeFailoverChain）；merge 落盘走 saveSettings 不过 normalize，对端 failover 引用本端不存在的 profileId 时会在下次 loadSettings 兜底清理（既有行为，非本步引入）
  - `update.serverUrl` 在白名单内：热更服务器地址随设备传播（两端同仓发布包，可接受；若将来双机不同源需移出白名单）
  - settingsBaseline 语义未动（记录合并落盘全量结果，orchestrator.ts:525 / apply.ts mergeIncomingSettings 两处），保本端后两轮收敛无振荡已由测试证明
