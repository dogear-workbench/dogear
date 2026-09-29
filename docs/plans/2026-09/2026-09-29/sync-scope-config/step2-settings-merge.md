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

- [x] 单测全绿（sync-options-merge.test.ts 20 用例；全仓 electron 316 pass / 0 fail）+ tsc 通过。
- [x] 手动（单机 dev，临时目录脚本未触碰真实 settings.json）：disabledSyncItems 加 'usage' → usage/ 不进清单；syncShadowGit 缺省时 shadow-git 不进清单；syncShadowGit=true → 恢复进清单；conflict 副本开关同验；rev 递增与非法 id 清洗均验。

## 实施记录（2026-09-29）

- 状态：✅ 完成。字段 + SYNC_ITEM_IDS 元数据（12 项中文名/说明）+ normalize 白名单清洗；applySyncOptionsPatch 统一 rev 维护；computeMergedSettings 范围字段整组 rev-LWW；excludesFromSyncOptions 唯一转换点（orchestrator 与 getManifestOptions 两侧共用，语义同向直传）。
- **拍板：rev 自增触发集 = 五个 rev 组字段（含 syncStocksData/syncFeishu）**，比任务书字面三字段多两项。理由：设计 §3.2 merge 规则「其余 syncOptions 字段整体取 rev 大者」本就含 stocks/feishu，若其变更不 bump rev 则「rev 相同保本端」使其永远无法跨端传播（相比现状取对端是行为退化）。设计文档已同步修正。
- 附带改进：对端 syncOptions 合并前过 normalizeSyncOptions（原裸 cast）；computeMergedSettings export + 可注入 localSyncOptions 供单测。
- setSyncOptions（tipc）改走 applySyncOptionsPatch，input 类型 Partial<SyncOptions> 自动兼容新字段，Step 3 UI 可直传。

## 不做

- tipc schema 与 UI（Step 3）；双机联调（Step 3 验收节）。
