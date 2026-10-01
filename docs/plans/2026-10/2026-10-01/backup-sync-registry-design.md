# 备份与同步统一重构（data-registry）设计

**背景**：2026-10-01 双审计（共享区 20261001-backup-audit.md / 20261001-sync-audit.md）证实：
- 备份 2 个数据丢失级 bug：tasks 分类打包路径完全错误（`categories.ts:99`，任务数据零备份）；notes-groups 漏备 groups.json（索引损坏不可恢复）。且自动备份失败全链路静默。
- 同步 4 个数据丢失级：push 接收端零校验（server.ts:303 直写任意路径，可绕过范围/开关/清 sync-state 基线）；settings.json 合并以对端为底丢本端字段；冲突副本固定名互相覆盖；删除不传播且被对端复活。
- 两套数据范围定义零代码共享（备份 categories.ts vs 同步 manifest.ts/SYNC_ITEM_IDS），分叉已实际发生。2026-09-27 同步事故靠手工 python 脚本恢复，备份未发挥作用。

**目标**：
1. 单一数据清单 **data-registry** 作为备份与同步共同的事实源，消除双份路径知识
2. 备份简化：清单驱动打包/轮换，失败可见，恢复升级为**快照还原**语义
3. 同步堵住数据丢失洞（D1/D2/D3/F1/U6），删除改为**墓碑传播**

**架构**（核心做法）：

1. **registry 模块**（新 `electron/main/services/data-registry.ts`）：每项数据一条定义
   ```
   { id, paths(相对 configDir 或声明外部锚点), sensitive, mergePolicy: 'file'|'records'|'settings-fields', backupCategory?, syncItemId? }
   ```
   - 备份分类（notes-groups/memory/tasks/sessions + 新增 app-config）的源列表由 registry 派生；同步的 SYNC_ITEM_IDS/excludes 也由 registry 派生。路径知识只此一份。
   - 外部锚点：tasks.json 存于用户磁盘工作区（`workspace.path/.dogear/tasks.json`，从 workspaces.json 解析），zip 内用虚拟前缀 `__ws-external__/<wsid>/` 映射，恢复时写回原位。
2. **备份行为**：
   - 分类 UI 骨架不变，notes-groups 显示名改「笔记与工作区」，源补 groups.json/conversations.json/config.json/agent.md；sessions 并入 conversations/（harness 存储）；新增「应用配置」类（settings.json/plans.json/notifications.json/login-accounts.json，daily）；tasks 源路径修正。
   - 调度不变（启动即查 + 30min tick）；失败写 lastError 暴露到 getBackupStatus（I-7）；adm-zip 打包移 worker_threads（I-6）。
   - **恢复 = 快照还原**：zip 内条目写回原位，zip 外的现存文件删除；恢复前自动预备份（尊重用户 keep，I-5）+ showConfirm 明示「多余文件将被删除」；恢复 sessions/conversations 前检查运行中会话，有则阻止（I-4），恢复后失效 pi-session 元数据缓存。
3. **同步堵洞**（保留三方基线机制，不改协议主体）：
   - push 接收端校验（D1/S1）：handleFilePush 落盘前过 isExcluded + 工作区 enabled 映射 + 禁写 sync-state.json/backup 目录等敏感路径，与 pull 侧 applyIncoming 对称。
   - 冲突副本文件名带时间戳（D3）：`.conflict-<短ID>-<ts>`，不再静默覆盖。
   - settings.json 字段级三方合并（D2）：sync-state 为 settings.json 额外存基线内容快照；合并时逐顶层字段与基线比，取变的一侧，双侧都变取本端并记 warning。两个入口（pull 合并 + push 侧 mergeIncomingSettings）共用同一实现。
   - stocks/feishu 开关接入 excludes 统一体系（F1），isExcluded 消费 OPTIONAL_DIR_FLAGS。
   - normalizeSyncOptions 拒绝 required 项（settings.json）进 disabledSyncItems（U6）。
4. **墓碑删除传播**（F6）：
   - 删除检测：本端清单 vs 基线（基线有、现无）→ 记墓碑 `{relPath, deletedAt, deviceId}` 入 sync-state（上限 + 90 天过期清理）。
   - 传播：对端清单有此路径且 == 基线 → 执行删除；对端改过 → 「删改冲突」，保守保留文件并入 report 提示，不自动删。
   - 记录类文件（merge registry）条目级删除不传播（并集语义维持），仅整文件删除走墓碑。

**排除的选项**：
- 只修 bug 不引 registry——治标，双份定义分叉温床仍在（本次两 bug 即产物）。
- 备份并入同步引擎——定位正交（时点快照+轮换 vs 双端收敛），机制合并徒增复杂度。
- 同步扩展到用户磁盘工作区（tasks.json 跨设备）——同步根仍限 configDir，YAGNI。

**模块边界**：
- 新增：`electron/main/services/data-registry.ts`
- 备份：`backup-service/categories.ts`（派生化）、`index.ts`（恢复语义/预备份 keep/防护）、`zip-pack.ts`（worker 化 + 外部路径）、`schedule.ts`（lastError）、`tipc/backup.ts`（状态字段）
- 同步：`sync/server.ts`（push 校验）、`sync/apply.ts`（副本时间戳、settings 三方合并）、`sync/manifest.ts`（F1、墓碑 diff）、`sync/sync-state.ts`（墓碑存储、settings 基线内容）、`sync/orchestrator.ts`（删改冲突上报）、`settings-types.ts`（registry 派生接线）
- 前端：`app/data-center/version-backup/*`（新分类卡片、lastError、恢复文案）、`sync-result.tsx`（删改冲突展示）

**数据流**：
- 备份：tick → registry 派生各分类源 → worker 打包（外部锚点走虚拟前缀）→ 轮换清理 → 状态（含 lastError）→ UI 30s 轮询
- 恢复：选 zip → 预备份（用户 keep）→ 解包写回 + 删除 zip 外文件 → 缓存失效 → 完成提示
- 同步：manifest（registry 派生 excludes）→ 三方 diff（含墓碑判定）→ pull 过滤 apply / push 接收端对称校验 → 基线更新 + 墓碑维护

**错误处理 / 边界**：
- 恢复删多余文件仅限该分类源路径内（registry 声明边界），绝不越界删；外部锚点（tasks.json）恢复按 workspaces.json 反解，工作区已注销则跳过并警告。
- 墓碑与 sync-state 写入加同一把锁（顺带修 F5 读改写互踩）。
- worker 打包失败/超时回退主进程异步分片，保底可用。
- 旧备份 zip 无虚拟前缀，恢复时按旧规则兼容读。

**未决问题**（实施时定）：
- settings 字级合并的深层嵌套粒度（顶层字段 vs 递归深合并）
- 墓碑清理周期与上限的具体数值
- 「笔记与工作区」分类显示名的最终文案

**明确不做**：tasks.json 跨设备同步；stocks/feishu/usage/run-history 备份；login-accounts.json 同步。
