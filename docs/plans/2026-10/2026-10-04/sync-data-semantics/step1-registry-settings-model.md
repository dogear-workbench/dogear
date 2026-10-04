---
step: 1
title: 数据层地基（registry 补录 + settings 模型）
status: done
---

## 目标
registry 补 ws-tasks / ws-articles 两个同步项声明，syncOptions 增加 userSyncPaths 模型，立 settings 传播白名单常量——后续所有步骤的数据契约在这步定形。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.1（分类）、§2.2（A 模型）、§2.5（userSyncPaths）
- 现状：`data-registry.ts` 的 `ws-tasks` 条目已有 `external: 'workspace-tasks'`、`__ws-external__/{wsid}/.dogear/tasks.json` 路径形式，缺 `syncItemId`；无 articles 条目
- `SYNC_ITEM_IDS` 由 `registrySyncItems()` 派生（settings-types 消费），新增 id 自动进入同步项枚举

## 计划改动
- [x] `electron/main/services/data-registry.ts`：`ws-tasks` 补 `syncItemId: 'tasks'`；新增 `ws-articles` 条目（`paths: ['__ws-external__/{wsid}/.dogear/articles']`、`external: 'workspace-articles'`、`mergePolicy: 'file'`、`backupCategory: 'notes-groups'` 是否合适需核对——articles 是用户内容产物，备份覆盖是另一个话题，本步只挂同步项，backupCategory 留空并在回填注明）；`registrySyncItems` 派生逻辑确认覆盖新条目
- [x] `electron/main/services/settings-types.ts`：`SyncOptions` 加 `userSyncPaths?: Record<string, string[]>`（wsid → 工作区相对路径列表）；`normalizeSyncOptions` 清洗（值必须是 Record<string, string[]>，非法丢弃）；确认 `disabledSyncItems` 合法值集合随 SYNC_ITEM_IDS 派生扩展
- [x] settings 层立 `SETTINGS_SYNC_FIELDS` 传播白名单常量（草案：ai / basicToolPermissions / subAgent / failover / update / appearance / browserSearchEngine / enabledToolPacks / webAiSites / paymentBlockedHosts；Step 5 逐字段核对定稿）
- [x] 测试：normalizeSyncOptions 对 userSyncPaths 的清洗；registrySyncItems 含 tasks/articles

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 白名单草案去掉 `enabledToolPacks`：该字段已迁工作区 config（2026-08 claude-cleanup step4），AppSettings 无此顶层字段，设计文档草案过时
  2. `SYNC_ITEM_IDS` 并非由 `registrySyncItems()` 代码派生（settings-types 承诺无 electron 依赖不能反向 import），实为手写列表 + 双侧测试锁定一致性（data-registry.test.ts 与 sync-options-merge.test.ts）；新增 tasks/articles 同步改两处列表与两处测试
  3. 抽了模块级 `cleanRelPathList` helper：snapshot excludedPaths 与 userSyncPaths 条目清洗规则同源复用，避免分叉
  4. ws-articles 条目 `backupCategory` 留空（现场判断点）：articles 是用户内容产物，备份覆盖是另一话题，本步只挂同步项；测试锁定 `backupCategory` 为 undefined
- 改动文件清单：`electron/main/services/data-registry.ts`、`electron/main/services/settings-types.ts`、`electron/main/services/data-registry.test.ts`、`electron/main/services/sync/sync-options-merge.test.ts`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `DataItem.external`：`'workspace-tasks' | 'workspace-articles'`；`EXTERNAL_ARTICLES_REL = '.dogear/articles'`（data-registry.ts，与 EXTERNAL_TASKS_REL 对称）
  - registry：`ws-tasks` → syncItemId `'tasks'`；`ws-articles` → syncItemId `'articles'`，均走 `__ws-external__/{wsid}/` 虚拟前缀；`registrySyncItems()` 过滤逻辑未变，自动覆盖新条目
  - `SyncOptions.userSyncPaths?: Record<string, string[]>`（wsid → 工作区相对路径列表）；`normalizeUserSyncPaths(raw)`：值非数组整键丢弃、条目反斜杠转斜杠/剥 ./ 前缀/去首尾斜杠/去重/空串丢弃、空数组键保留；normalizeSyncOptions 输出恒含 `userSyncPaths: {}`
  - `SETTINGS_SYNC_FIELDS`（settings-types.ts，9 项草案）+ `SettingsSyncField` 类型；`as const satisfies readonly (keyof AppSettings)[]` 编译期防 typo
- 下个 step 该从哪里继续：Step 2（task-store planPath 相对化）不依赖本步改动可并行；Step 3 消费 registry 虚拟路径条目（buildManifest）与 `EXTERNAL_ANCHOR_PREFIX`/`EXTERNAL_ARTICLES_REL`；Step 4 接 SETTINGS_SYNC_FIELDS 进 mergeFieldsThreeWay；Step 6 UI 写 userSyncPaths 时需同时把 userSyncPaths 加进 applySyncOptionsPatch 的 rev 组（scopeChanged 判定）与 tipc setSyncOptions 防呆白名单，否则改勾选不 bump rev 导致两端拉扯
- 待办或已知限制：
  - 同步范围面板（sync-settings.tsx）已自动出现「任务」「文章库」两个开关，但 isExcluded/buildManifest 的虚拟路径生效在 Step 3/4，本步后开关尚不产生实际排除效果（预期分步状态）
  - `enabledToolPacks` 不在白名单草案内（字段已不存在）；Step 5 核对其余 9 项内容后定稿
