---
step: 2
title: 备份接 registry
status: done
---

## 目标
备份分类源全部改由 registry 派生：修 I-1（tasks 路径）、I-2（补 groups.json 等）、新增 app-config 分类、外部锚点打包/恢复。

## 依赖上下文（接力棒输入）
- （执行时回填 step1 接力棒：backupSourcesFor 签名与外部锚点表示）
- 现状关键文件：`electron/main/services/backup-service/categories.ts`（resolveSources 手写路径，:86-102 为 I-1/I-2 病灶）、`zip-pack.ts`、`electron/main/services/settings-types.ts` DEFAULT_SETTINGS.backup、`app/data-center/version-backup/backup-meta.ts` CATEGORY_META

## 计划改动
- [x] `categories.ts`：删除 resolveSources 的手写 switch，改调 registry 的 backupSourcesFor；BACKUP_CATEGORIES 增加 `app-config`（scopes: ['global']，daily/keep10）；notes-groups 显示名改「笔记与工作区」
- [x] 源修正：tasks 走外部锚点（I-1）；notes-groups 补 groups.json/conversations.json/config.json/agent.md、去掉已下线的 dashboard.md（I-2）；sessions 源追加 `conversations/`
- [x] `settings-types.ts` DEFAULT_SETTINGS.backup 补 app-config 默认值；`backup-meta.ts` 默认配置改从 categories 常量导入（消除三处重复定义）
- [x] `zip-pack.ts`：打包支持外部锚点 → zip 内虚拟前缀 `__ws-external__/<wsid>/`；`index.ts` restoreBackup 反解时读 workspaces.json 映射回真实路径，工作区已注销则跳过并警告（此步只做路径反解，快照还原语义在 step4）
- [x] UI：`backup-meta.ts` 新分类元数据 + `VersionBackupPanel`/`CategoryCard` 无需结构改动（分类驱动渲染），确认 app-config 卡片正常出现

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `resolveSources` 直接删除而非保留薄委托：backup-service/categories.ts 不再提供源解析，`index.ts` 改从 registry 直接 import `backupSourcesFor`（源解析知识完全收敛到 registry）
  2. `workspaceRoot` 一并删除（resolveSources 删除后无消费方）；`assertScope` 保留但委托 `assertRegistryScope`（zip-pack/backupDirPath 消费方不变）
  3. 「三处重复定义」的收敛点落在 settings-types.ts（非 categories.ts）：BACKUP_CATEGORY_DEFAULTS 定义在 settings-types.ts（无 electron 依赖，前端 backup-meta.ts 按 sync-settings.tsx 既有模式直接 import 主进程 settings-types）；categories.ts 的 BACKUP_CATEGORIES 整表改为从 BACKUP_CATEGORY_KEYS×BACKUP_CATEGORY_SCOPES×BACKUP_CATEGORY_DEFAULTS 派生，仅 CATEGORY_NAMES 显示名本地保留
  4. settings-types.ts 的 `BACKUP_SETTING_KEYS` 无法从 registry import（registry→settings-service→electron，而 settings-types 承诺无 electron 依赖、被 Worker/前端导入），app-config 以字面量手工同步并加 WHY 注释
  5. `packSources` 改 async（外部锚点反解需 await `resolveArchiveRelPath`）；`VersionBackupPanel.updateCategoryConfig` 的硬编码 4 键对象改为遍历 BACKUP_CATEGORY_ORDER 生成（否则保存配置会丢 app-config）
- 改动文件清单：
  - `electron/main/services/settings-types.ts`：BACKUP_SETTING_KEYS +app-config、新增 BACKUP_CATEGORY_DEFAULTS（默认值唯一源）、DEFAULT_SETTINGS.backup 引用它、注释更新
  - `electron/main/services/backup-service/categories.ts`：删 resolveSources/workspaceRoot/本地 GLOBAL_SCOPE·BackupScope·BACKUP_CATEGORY_KEYS·assertScope 正则；改 registry import + re-export；BACKUP_CATEGORIES 派生化；+app-config「应用配置」；notes-groups 改名「笔记与工作区」
  - `electron/main/services/backup-service/zip-pack.ts`：删本地 toZipEntryPath 改用 registry `toArchiveRelPath`；packSources 改 async，外部锚点源经 `resolveArchiveRelPath` 反解读取真实文件、zip 条目仍写虚拟路径
  - `electron/main/services/backup-service/index.ts`：resolveSources→backupSourcesFor；packSources 加 await；extractZipTo 锚点条目反解写回、null（注销/非法）console.warn 跳过，非锚点条目维持 targetRoot 相对 + zip slip 防护不变（旧 zip 兼容）
  - `types/settings.ts`（前端平行类型）：BACKUP_CATEGORY_KEYS +app-config、注释同步
  - `app/data-center/version-backup/backup-meta.ts`：ORDER +app-config；CATEGORY_META +app-config 卡片、notes-groups 改名；defaultConfig 改从主进程 BACKUP_CATEGORY_DEFAULTS 导入
  - `app/data-center/version-backup/VersionBackupPanel.tsx`：updateCategoryConfig 分类驱动生成完整 categories 对象

### 验证
- bun test：400 pass / 0 fail / 1 skip（与 step1 基线一致，存量测试未受影响）
- bun run build:electron：通过；前端 `tsc -p tsconfig.json --noEmit`：通过
- 临时目录端到端 smoke：app-config 源=6 文件；tasks 源=外部锚点虚拟路径；notes-groups 源含 groups.json/conversations.json/config.json/agent.md 且无 dashboard.md；sessions 源含 conversations；tasks 打包 zip 条目=`__ws-external__/<wsid>/.dogear/tasks.json`；restore 反解写回真实位置成功；工作区注销后 restore 跳过并警告不抛错；getBackupStatus 含 app-config(global)

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `packSources(sources, outZipPath): Promise<number>`（原同步，调用方需 await）
  - 默认配置唯一源：`settings-types.ts` `BACKUP_CATEGORY_DEFAULTS: Record<BackupSettingCategoryKey, BackupCategorySetting>`（5 分类）；categories.ts `BackupCategoryConfig = BackupCategorySetting` 别名
  - categories.ts re-export registry 的 GLOBAL_SCOPE/BackupScope/BACKUP_CATEGORY_KEYS/BackupCategoryKey，消费方（tipc/backup.ts、schedule.ts）零改动
- 下个 step 该从哪里继续：step3（备份失败可见 lastError + worker 化）接 schedule.ts/tipc；step4（快照还原语义）直接消费 extractZipTo 现有反解分支，把「zip 外现存文件删除 + 恢复前检查运行中会话 + showConfirm 文案」补齐；预备份 keep 用用户配置的修正也在 step4
- 待办或已知限制：
  - 旧备份 zip 无虚拟前缀，恢复走非锚点分支天然兼容（已验证逻辑路径）；但旧 tasks zip 当年打包的是错误路径（workspaces/<id>/.dogear/tasks.json 不存在→当年 zip 实际为空），无数据可迁移
  - settings-types.ts BACKUP_SETTING_KEYS 与 registry BACKUP_CATEGORY_KEYS 的平行靠注释约定，step5 同步侧接线时若引入无依赖共享层可再收敛
  - 前端 types/settings.ts 与主进程 settings-types.ts 的 BackupSettings 类型仍为平行定义（既有结构，本 step 仅同步了 key 清单）
