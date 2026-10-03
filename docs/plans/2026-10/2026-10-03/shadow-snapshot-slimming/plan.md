# 影子快照收窄 实施计划

**目标**：把影子 git 从「无差别全量历史」收窄为「编辑行为回滚安全网」——大小阈值 + 排除目录 + 30 天保留窗口 + 按工作区开关（推荐配置可改可恢复默认），UI 可解释，并对当前工作区做一次性存量瘦身（释放 ~1.2GB）。

**架构思路**：沿用 `BACKUP_CATEGORY_DEFAULTS` 的「推荐配置 + 可改 + 恢复默认」模式新增 SnapshotSettings；`shadow.ts` 在 add 阶段做目录 pathspec 排除 + 暂存区大小过滤；保留裁剪走按工作区串行队列；存量瘦身只做手动触发（历史重写 + gc），不做自动。设计详情见 [shadow-snapshot-slimming-design.md](../shadow-snapshot-slimming-design.md)。

**涉及模块**：`electron/main/services/git-service/shadow.ts`、`electron/main/services/settings-types.ts`、`electron/main/tipc/git.ts`、`app/settings/WorkspaceManagementTab.tsx`、`components/FileHistoryPanel.tsx`、`electron/main/services/backup-service/categories.ts`、`electron/main/services/data-registry.ts`（step6）

## 步骤索引

- [x] [Step 1: 快照规则收窄（settings 类型 + shadow 接入）](./step1-rules.md) — 阈值过滤、排除目录配置化、按工作区开关
- [x] [Step 2: 保留窗口裁剪](./step2-retention.md) — 近 7 天全留 → 7~30 天每日一份 → 30 天外丢弃
- [x] [Step 3: 设置页快照状态卡与配置](./step3-settings-ui.md) — 状态卡（开关/体积/条数/上次时间）+ 配置区 + 恢复默认
- [x] [Step 4: 历史面板空态可解释 + 备份 personal 过滤](./step4-misc.md) — 空态区分「未编辑」vs「被排除+原因」；listWorkspaceIds 按注册表过滤
- [x] [Step 5: 存量瘦身](./step5-slim.md) — 设置卡「立即瘦身」按钮：按新规则重写历史 + gc，释放 ~1.2GB
- [ ] [Step 6: sessions 备份拆分（全局会话单独归类）](./step6-backup-sessions.md) — 全局 conversations/ 备成 global/sessions，工作区 zip 只含自己的会话

## 全局决策

- 配置结构对齐 `BackupSettings` 模式（`settings-types.ts` 内类型 + 默认值常量；`AppSettings` 挂新字段 `snapshot`）
- 默认值（已与用户拍板）：阈值 8MB；排除目录 = 现有 7 个（node_modules,out,dist,release,tmp,.dogear,.git）+ `update-server`、`release2`；窗口 = 标准档（近 7 天全留 → 7~30 天每天留最后一条 → 30 天外丢弃）；按工作区开关默认开
- 快照、保留裁剪、瘦身共用按工作区串行队列（复用 shadow.ts 现有队列机制），天然互斥
- 大小过滤在暂存区做（add 后 `git diff --cached` 枚举新 blob 超阈值则 unstage），不做全量 stat、不做持久化跳过名单
- 历史重写只允许用户手动触发（带确认），代码中不做任何自动重写
- 快照开关关闭的工作区：文件历史双源合并自然退化为用户 git 单源，无需特判报错
- 主进程改动需 `build:electron` 重新编译后才能在应用内验证
