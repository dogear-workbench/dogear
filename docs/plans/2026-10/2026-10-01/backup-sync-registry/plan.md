# 备份与同步统一重构（data-registry）实施计划

**目标**：以单一数据清单 registry 为事实源，重修备份（含快照还原、失败可观测）与同步（堵数据丢失洞、墓碑删除传播）。

**架构思路**：新建 `data-registry.ts` 承载全部数据项定义（路径/敏感性/合并策略/备份分类/同步项），备份与同步全部从它派生；备份先行落地（简单且立刻有保护），同步随后堵洞，墓碑最后。设计全文见 [../backup-sync-registry-design.md](../backup-sync-registry-design.md)，审计依据见共享区 20261001-backup-audit.md / 20261001-sync-audit.md。

**涉及模块**：`electron/main/services/data-registry.ts`（新）、`backup-service/*`、`sync/*`、`tipc/backup.ts`、`tipc/sync.ts`、`settings-types.ts`、`app/data-center/version-backup/*`、`app/data-center/sync-result.tsx`

## 步骤索引

- [x] [Step 1: data-registry 模块](./step1-registry.md) — 数据项定义表 + 备份/同步派生函数 + 单测
- [x] [Step 2: 备份接 registry](./step2-backup-registry.md) — 分类源派生化、修 I-1/I-2、新增 app-config 分类、外部锚点打包
- [x] [Step 3: 备份可观测 + worker 打包](./step3-backup-observability.md) — lastError 暴露、zip 移 worker 线程、UI 状态
- [x] [Step 4: 恢复升级快照还原](./step4-restore-snapshot.md) — 删多余文件、预备份 keep、会话防护、缓存失效
- [ ] [Step 5: 同步堵洞（轻量组）](./step5-sync-fixes.md) — D1 push 校验、D3 副本时间戳、F1 flag 接入、U6
- [ ] [Step 6: settings 字段级三方合并](./step6-settings-merge.md) — D2 修复 + sync-state 加锁（F5）
- [ ] [Step 7: 墓碑删除传播](./step7-tombstones.md) — 协议 v3、删除指令、删改冲突、UI
- [ ] [Step 8: 收尾](./step8-wrapup.md) — doc-sync、轻项清理、完成总结

## 全局决策

- **路径知识唯一源**：所有数据路径/清单定义只写在 `data-registry.ts`；`backup-service/categories.ts` 与 `sync/manifest.ts`、`settings-types.ts` 的 SYNC_ITEM_IDS 只消费派生结果，出现第二份硬编码路径即为 bug
- **同步协议**：Step 7 起升 v3（墓碑交换），版本不匹配复用既有 confirmVersionMismatch 流程
- **外部锚点**：configDir 外文件（tasks.json）zip 内用虚拟前缀 `__ws-external__/<wsid>/`，恢复按 workspaces.json 反解真实路径
- **恢复安全边界**：快照还原删除文件仅限 registry 声明的该分类源路径内，绝不越界
- **新增备份分类 key**：`app-config`（settings.json/plans.json/notifications.json/login-accounts.json，daily/keep10 默认）；现有分类 key 不动，notes-groups 显示名改「笔记与工作区」
- **每步完成标准**：`bun test` 通过 + `bun run build:electron` 编译通过 + stepN 回填接力棒 + 本索引打勾
