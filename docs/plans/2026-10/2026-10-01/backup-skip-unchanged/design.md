# 备份无变更跳过（skip-unchanged）设计

**背景**：备份频率/开关/保留份数是分类级共享配置，调度对每个 scope 独立判到期后无条件打新 zip。闲置工作区每天产出一份与昨天几乎相同的 zip，浪费存储并占 keep 名额，且「最近备份时间」失去「最近一次有意义状态」的语义。用户拍板方案 A（无变更自动跳过），否决按工作区手动配频率（把自动化问题转成手动维护负担）。

**目标**：调度路径下，scope 源内容与上次成功备份时一致则不打新 zip，只在 last-run 记一条跳过记录；面板可见「内容无变化，已跳过」状态。手动「立即备份」与恢复预备份不受影响。

**架构**：

- 新模块 `electron/main/services/backup-service/source-signature.ts`：`computeSourceSignature(sources): Promise<string | null>`。对 backupSourcesFor 返回的源做递归扫描，收集（相对路径 + mtimeMs + size）排序拼接后 sha1，返回 hex；无任何存在文件时返回 null。**遍历语义必须与 packSources 的文件收集一致**（不存在源跳过、只算文件不算目录、外部锚点源按其绝对路径扫描），实施时从 zip-pack-core 提取或复用同一套遍历函数，禁止另写一套导致「签名集合 ≠ 打包集合」。
- `last-run.ts`：LastRunEntry 增加 `signature?: string | null`（上次成功备份时的源签名）与 `skipped?: boolean`（该次执行为无变化跳过）。recordCategoryRun 增加可选 extra 参数。skipped 视为成功执行（ok=true, error=null），lastError 语义不变。
- `schedule.ts` isDue 改造：到期锚点从「最新 zip 时间戳」改为 `max(最新 zip 时间戳, last-run 该 key 最近执行时间)`。跳过后 last-run.time 刷新 → 下个周期不再到期 → 消除「到期徽标常亮 + 每 30 分钟重算签名」的空转。isDue 需要新增一次 readCategoryRun 读取。
- `index.ts` runBackupAll：仅 onlyDue 路径，isDue 通过后先算签名与 last-run.signature 比对，相同 → recordCategoryRun(skipped=true, signature 不变) + continue；不同 → 正常 runBackup，成功后 recordCategoryRun(ok, signature=新签名)。**skip 判断放在 runBackupAll 层而非 runBackupInner**，保证手动备份与恢复预备份永不跳过。

**模块边界**：

| 文件 | 改动 |
|------|------|
| `backup-service/source-signature.ts` | 新建：签名计算 |
| `backup-service/last-run.ts` | Entry 加 signature/skipped，recordCategoryRun 加 extra |
| `backup-service/schedule.ts` | isDue 锚点含 last-run 时间 |
| `backup-service/index.ts` | runBackupAll 插入 skip 判断；BackupScopeStatus 加 lastSkippedAt |
| `app/data-center/version-backup/CategoryCard.tsx` | scope 行加浅色提示「内容无变化，已跳过（时间）」 |
| `backup-meta.ts` / tipc | BackupScopeStatus 经 tipc 类型自动推导跟随 |

**数据流**：tick → runDueBackups → runBackupAll(onlyDue) → isDue（zip 时间戳与 last-run.time 取 max）→ 算签名 → 与 last-run.signature 相同？→ 是：记 skipped、continue；否：runBackup 打 zip → 成功后记录新签名。

**错误处理 / 边界情况**：

- 签名计算失败（如权限）：按「有变化」处理，走正常备份，不因签名故障丢备份。
- 签名计算不加 scope 队列，可能与进行中备份竞态：最坏多打或少打一次，下周期自愈，可接受。
- last-run.json 是 registry 排除项、不跨设备同步：换设备/重装后签名丢失 → 下次备份正常打一份并重建签名，自愈。
- 恢复写回文件 → mtime 变化 → 下次调度正常打新备份，符合预期。
- 无变化跳过不累计计数（YAGNI），只显示最近一次跳过时间。
- 旧版 last-run.json 无 signature 字段：undefined 视为「无签名」→ 首次必打一份并写入签名。

**未决问题**：无（跳过提示行展示已定为「内容无变化，已跳过 + 时间」单行浅色文本，不做计数）。
