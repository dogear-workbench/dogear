# Step 2: 设置模型与两端统一

## 目标

settings.syncOptions 落地三个新字段 + syncOptionsRev 修订号；settings.json 的 merge registry 支持「范围字段整体取 rev 高者」；orchestrator / lan-sync-service 从设置构造 excludes 并透传。本步完成后主进程侧配置链路全通。

依赖 Step 1 的 ManifestOptions.excludes 结构。

## 改动

### 1. `settings-types.ts`

- `SyncOptions` 增加：`disabledSyncItems?: string[]`、`syncConflictCopies?: boolean`、`syncShadowGit?: boolean`、`syncOptionsRev?: number`。
- `normalizeSyncOptions`（settings-types.ts:363-389）：补默认值（[]/false/false/0）与非法值清洗（disabledSyncItems 过滤到合法 SyncItemId 枚举，去重；防路径穿越字符——只允许枚举内 id）。
- 导出 `SYNC_ITEM_IDS` 常量（12 项 id + 每项的中文名/说明，供 Step 3 UI 与 normalize 共用）。

### 2. `settings-service.ts`

- `setSyncOptions`（或等价写入口）：检测到范围字段（disabledSyncItems/syncConflictCopies/syncShadowGit）相对旧值变化时 `syncOptionsRev = max(old, ??0) + 1`；仅改 deviceName 不动 rev。

### 3. `sync/apply.ts` — settings merge registry 特判

现状（apply.ts:166-201）：deviceName 保本端、pairedDevices 并集。新增：

- 其余 syncOptions 字段（syncStocksData/syncFeishu/disabledSyncItems/syncConflictCopies/syncShadowGit）**原子取 syncOptionsRev 大的一端**。
- rev 相同内容不同 → 保本端（不落副本，下轮收敛）。
- rev 缺省（旧数据）按 0 处理。

### 4. `sync/lan-sync-service.ts` + `sync/orchestrator.ts`

- lan-sync-service.ts:68-76 现有 getManifestOptions 扩展：从 settings 构造 `excludes = { conflictCopies: syncConflictCopies, shadowGit: syncShadowGit, disabledItems: new Set(disabledSyncItems) }`。
- 确认 orchestrator.ts:118-125（options 构造）与 :442（buildNextBaseline）共用同一 options——现状已透传，核对即可。

### 5. 单测（扩展 `sync/merge-records.test.ts` 或新增 `sync/sync-options-merge.test.ts`）

- rev 大者胜（对端 rev 大 → 整体取对端范围字段）；本端大 → 保本端。
- deviceName / pairedDevices 不受 rev 影响（deviceName 各保各端、pairedDevices 并集照旧）。
- rev 相同内容不同 → 保本端。
- normalize：非法 id 滤除、缺省默认值。

## 验收

- 单测全绿。
- 手动（单机 dev）：改 settings.json 里 disabledSyncItems 加 `usage` → 跑 buildManifest 确认 usage/ 不进清单；syncShadowGit 缺省时 shadow-git 不进清单；再把 syncShadowGit=true → 恢复进清单。

## 不做

- tipc schema 与 UI（Step 3）；双机联调（Step 3 验收节）。
